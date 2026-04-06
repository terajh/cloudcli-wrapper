use std::env;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;

const SERVER_PORT: u16 = 3001;
const SERVER_HOST: &str = "127.0.0.1";
const MAX_WAIT_SECS: u64 = 30;

// Codex 다크 테마 색상을 claudecodeui 위에 강제 적용하는 CSS 인젝션 스크립트.
// page load 전후 모두 동작하도록 readyState 체크 + MutationObserver로 재주입.
const THEME_INJECTION_JS: &str = r#"
(function() {
  var STYLE_ID = '__caui_theme_override__';
  var CSS = `
    :root.dark, .dark {
      --background: 0 20% 2.9% !important;
      --foreground: 0 0% 100% !important;
      --card: 0 12% 6% !important;
      --card-foreground: 0 0% 100% !important;
      --popover: 0 12% 6% !important;
      --popover-foreground: 0 0% 100% !important;
      --primary: 209 100% 60% !important;
      --primary-foreground: 0 0% 100% !important;
      --secondary: 0 10% 10% !important;
      --secondary-foreground: 0 0% 100% !important;
      --muted: 0 10% 10% !important;
      --muted-foreground: 0 0% 60% !important;
      --accent: 209 100% 60% !important;
      --accent-foreground: 0 0% 100% !important;
      --border: 0 8% 14% !important;
      --input: 0 8% 14% !important;
      --ring: 209 100% 60% !important;
      --nav-glass-bg: 0 20% 2.9% / 1 !important;
      --nav-input-bg: 0 10% 10% / 1 !important;
      --nav-glass-blur: 0px !important;
    }
    html, body { background-color: #090606 !important; color: #FFFFFF !important; }

    /* sidebar root: bg-background/80 backdrop-blur-sm 를 불투명하게 강제 */
    .bg-background\\/80,
    .bg-background\\/90,
    .bg-background\\/70,
    .bg-background\\/60,
    .bg-background\\/50 {
      background-color: #090606 !important;
    }
    .backdrop-blur-sm,
    .backdrop-blur,
    .backdrop-blur-md,
    .backdrop-blur-lg,
    .backdrop-blur-xl {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    /* sidebar 내부 카드/버튼 hover/selected: 약간 밝은 톤 */
    .bg-card { background-color: #100c0c !important; }
    .bg-muted\\/30 { background-color: rgba(255,255,255,0.03) !important; }
    .bg-muted\\/40 { background-color: rgba(255,255,255,0.04) !important; }
    .bg-muted\\/50 { background-color: rgba(255,255,255,0.05) !important; }
    .bg-muted\\/60 { background-color: rgba(255,255,255,0.07) !important; }
    .hover\\:bg-muted\\/60:hover { background-color: rgba(255,255,255,0.08) !important; }
    .hover\\:bg-accent:hover { background-color: rgba(255,255,255,0.06) !important; }

    /* border 색상도 톤 다운 */
    .border-border { border-color: rgba(255,255,255,0.08) !important; }
  `;
  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  inject();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  }
  // SPA 내비게이션이 head를 갈아끼울 경우 대비
  var observer = new MutationObserver(function() {
    if (!document.getElementById(STYLE_ID)) inject();
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
"#;

struct ServerProcess(Mutex<Option<Child>>);

fn cloudcli_dir() -> PathBuf {
    if let Ok(dir) = env::var("CLOUDCLI_DIR") {
        return PathBuf::from(dir);
    }
    let home = env::var("HOME").unwrap_or_else(|_| String::from("/"));
    PathBuf::from(home).join(".cloudcli").join("claudecodeui")
}

fn find_node() -> String {
    // 1. CLOUDCLI_NODE_BIN 환경변수가 있으면 우선 사용
    if let Ok(node) = env::var("CLOUDCLI_NODE_BIN") {
        if !node.is_empty() {
            return node;
        }
    }

    // 2. ~/.nvm/versions/node/*/bin/node 중 가장 최신 버전 탐색 (nvm 사용자 우선)
    if let Ok(home) = env::var("HOME") {
        let nvm_dir = PathBuf::from(&home).join(".nvm").join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.join("bin").join("node").exists())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                return latest.join("bin").join("node").to_string_lossy().to_string();
            }
        }
    }

    // 3. interactive shell(.zshrc 로드, nvm 적용됨)에서 node 경로 탐색
    if let Ok(output) = Command::new("/bin/zsh")
        .args(["-ic", "command -v node"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // 4. fallback
    String::from("node")
}

fn spawn_server() -> std::io::Result<Child> {
    let dir = cloudcli_dir();
    let server_entry = dir.join("server").join("index.js");
    let node = find_node();

    // node 실행에 필요한 PATH 구성 (nvm 등 로그인 셸 PATH 상속)
    let login_path = Command::new("/bin/zsh")
        .args(["-lc", "echo $PATH"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| env::var("PATH").unwrap_or_default());

    Command::new(&node)
        .arg(&server_entry)
        .current_dir(&dir)
        .env("SERVER_PORT", SERVER_PORT.to_string())
        .env("HOST", SERVER_HOST)
        .env("NODE_ENV", "production")
        .env("PATH", login_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit())
        .spawn()
}

fn wait_for_server_ready() -> bool {
    let addr = format!("{}:{}", SERVER_HOST, SERVER_PORT);
    let start = Instant::now();
    let timeout = Duration::from_secs(MAX_WAIT_SECS);

    while start.elapsed() < timeout {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn kill_server(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;

        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }

        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            match child.try_wait() {
                Ok(Some(_)) => return,
                _ => thread::sleep(Duration::from_millis(100)),
            }
        }

        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            thread::spawn(move || {
                match spawn_server() {
                    Ok(child) => {
                        let state = handle.state::<ServerProcess>();
                        *state.0.lock().unwrap() = Some(child);

                        if wait_for_server_ready() {
                            let url = format!("http://{}:{}", SERVER_HOST, SERVER_PORT);

                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.navigate(url.parse().unwrap());

                                // 페이지가 로드될 시간을 준 뒤 CSS 주입
                                thread::sleep(Duration::from_millis(800));
                                let _ = window.eval(THEME_INJECTION_JS);

                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            eprintln!("Server failed to start within {} seconds", MAX_WAIT_SECS);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to spawn server: {}", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<ServerProcess>();
                let mut guard = match state.0.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if let Some(ref mut child) = *guard {
                    kill_server(child);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

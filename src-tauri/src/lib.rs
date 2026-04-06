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
// 1) CSS 변수 오버라이드 2) 투명도/블러 제거 3) 스크롤바 숨김
// 4) 페이지가 늦게 로드되어도 적용되도록 setInterval로 재주입
const THEME_INJECTION_JS: &str = r#"
(function() {
  var STYLE_ID = '__caui_theme_override__';
  // CSS는 head 맨 마지막에 삽입되므로 자연스럽게 가장 마지막 cascade가 됨
  var CSS = [
    /* CSS 변수 오버라이드 */
    ':root.dark, .dark, html.dark, html {',
    '  --background: 0 0% 8% !important;',
    '  --foreground: 0 0% 100% !important;',
    '  --card: 0 0% 11% !important;',
    '  --card-foreground: 0 0% 100% !important;',
    '  --popover: 0 0% 11% !important;',
    '  --popover-foreground: 0 0% 100% !important;',
    '  --primary: 209 100% 60% !important;',
    '  --primary-foreground: 0 0% 100% !important;',
    '  --secondary: 0 0% 14% !important;',
    '  --secondary-foreground: 0 0% 100% !important;',
    '  --muted: 0 0% 14% !important;',
    '  --muted-foreground: 0 0% 65% !important;',
    '  --accent: 209 100% 60% !important;',
    '  --accent-foreground: 0 0% 100% !important;',
    '  --border: 0 0% 18% !important;',
    '  --input: 0 0% 18% !important;',
    '  --ring: 209 100% 60% !important;',
    '  --nav-glass-bg: 0 0% 8% / 1 !important;',
    '  --nav-input-bg: 0 0% 14% / 1 !important;',
    '  --nav-glass-blur: 0px !important;',
    '}',
    'html, body { background-color: #141414 !important; color: #FFFFFF !important; }',
    /* macOS overlay 타이틀바: 신호등 버튼 영역만큼 좌상단 비우기 */
    /* body::before는 투명한 드래그 영역만 제공 (시각적으로 가리지 않음) */
    'body::before {',
    '  content: "" !important;',
    '  position: fixed !important;',
    '  top: 0 !important;',
    '  left: 0 !important;',
    '  right: 0 !important;',
    '  height: 28px !important;',
    '  background: transparent !important;',
    '  z-index: 99999 !important;',
    '  -webkit-app-region: drag !important;',
    '  app-region: drag !important;',
    '}',
    /* 사이드바 데스크톱 헤더: pt-3 + md:block + pb-2 + px-3 조합으로 매칭 */
    'div[class*="hidden"][class*="md:block"][class*="pt-3"][class*="pb-2"][class*="px-3"] {',
    '  padding-top: 40px !important;',
    '}',
    /* 메인 콘텐츠 헤더 (탭/세션 정보) */
    '.pwa-header-safe {',
    '  padding-top: 36px !important;',
    '}',
    /* 투명도가 있는 background 클래스 모두 불투명 강제 (attribute selector로 매칭) */
    '[class*="bg-background"] { background-color: #141414 !important; }',
    /* 모든 backdrop-blur 제거 */
    '[class*="backdrop-blur"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
    /* card / muted 톤 통일 */
    '[class*="bg-card"] { background-color: #1c1c1c !important; }',
    '[class~="bg-muted/30"], [class*="bg-muted\\/30"] { background-color: rgba(255,255,255,0.03) !important; }',
    '[class~="bg-muted/40"], [class*="bg-muted\\/40"] { background-color: rgba(255,255,255,0.04) !important; }',
    '[class~="bg-muted/50"], [class*="bg-muted\\/50"] { background-color: rgba(255,255,255,0.05) !important; }',
    '[class~="bg-muted/60"], [class*="bg-muted\\/60"] { background-color: rgba(255,255,255,0.07) !important; }',
    /* hover/selected 톤 */
    '[class*="hover:bg-muted"]:hover { background-color: rgba(255,255,255,0.08) !important; }',
    '[class*="hover:bg-accent"]:hover { background-color: rgba(255,255,255,0.06) !important; }',
    /* 사이드바 root: ScrollArea 부모도 불투명 */
    '.backdrop-blur-sm, .backdrop-blur, .backdrop-blur-md, .backdrop-blur-lg, .backdrop-blur-xl {',
    '  background-color: #090606 !important;',
    '}',
    /* border 톤 다운 */
    '.border-border, [class*="border-border"] { border-color: rgba(255,255,255,0.08) !important; }',
    /* ─── 스크롤바 완전 숨김 (전역) ─── */
    '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; background: transparent !important; }',
    '*::-webkit-scrollbar-track, *::-webkit-scrollbar-thumb, *::-webkit-scrollbar-corner { display: none !important; background: transparent !important; }',
    'html, body, * { scrollbar-width: none !important; -ms-overflow-style: none !important; }'
  ].join('\n');

  function inject() {
    var existing = document.getElementById(STYLE_ID);
    if (existing) {
      // head 맨 끝으로 이동시켜 cascade 우선순위 보장
      if (existing.parentNode && existing.parentNode.lastChild !== existing) {
        existing.parentNode.appendChild(existing);
      }
      return;
    }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // 즉시 1회 + DOMContentLoaded + load 이벤트 + 폴링
  inject();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  }
  window.addEventListener('load', inject);

  // 첫 5초간 250ms마다 재주입 (React 마운트 + 동적 CSS 로드 대응)
  var attempts = 0;
  var interval = setInterval(function() {
    inject();
    attempts++;
    if (attempts >= 20) clearInterval(interval);
  }, 250);

  // 그 이후엔 MutationObserver로 head 변화 감시
  var observer = new MutationObserver(function() { inject(); });
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

                                // 1차 주입 후 즉시 윈도우 표시
                                thread::sleep(Duration::from_millis(600));
                                let _ = window.eval(THEME_INJECTION_JS);
                                let _ = window.show();
                                let _ = window.set_focus();

                                // 백그라운드에서 추가 주입 (스크립트 내부 setInterval과 이중 보장)
                                let win_clone = window.clone();
                                thread::spawn(move || {
                                    for delay_ms in [600u64, 1000, 1500, 2000] {
                                        thread::sleep(Duration::from_millis(delay_ms));
                                        let _ = win_clone.eval(THEME_INJECTION_JS);
                                    }
                                });
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

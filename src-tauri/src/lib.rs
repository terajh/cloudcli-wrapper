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

                                thread::sleep(Duration::from_millis(500));
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

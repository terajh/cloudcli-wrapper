use std::env;
use std::fs::{File, OpenOptions};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;

const SERVER_PORT: u16 = 3001;
const SERVER_HOST: &str = "127.0.0.1";
const MAX_WAIT_SECS: u64 = 30;

// Codex 다크 테마 색상을 claudecodeui 위에 강제 적용하는 CSS 인젝션 스크립트.
// 1) CSS 변수 오버라이드 2) 투명도/블러 제거 3) 스크롤바 숨김
// 4) 페이지가 늦게 로드되어도 적용되도록 setInterval로 재주입
const THEME_INJECTION_JS: &str = r#"
(function() {
  var STYLE_ID = '__vienna_theme_override__';
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
    /* 메인 콘텐츠는 중간 회색 (#161616), 사이드바는 약간 더 밝은 회색 (#1f1f1f) */
    'html, body { background-color: #161616 !important; color: #FFFFFF !important; }',
    /* 사이드바 (bg-background/{50..90}, backdrop-blur-* 클래스로 매칭) → 밝은 회색 */
    '[class*="bg-background\\/"] { background-color: #1f1f1f !important; }',
    '[class*="backdrop-blur"] { background-color: #1f1f1f !important; }',
    /* 메인 콘텐츠 헤더 (.pwa-header-safe) → 메인과 동일한 회색 */
    '.pwa-header-safe { background-color: #161616 !important; }',
    /* macOS overlay 타이틀바: 좌상단에만 드래그 영역을 두어 traffic lights 커버. */
    /* 좌측 160px 내에만 배치해 우측 탭 아이콘 클릭/hover를 방해하지 않음. */
    'body::before {',
    '  content: "" !important;',
    '  position: fixed !important;',
    '  top: 0 !important;',
    '  left: 0 !important;',
    '  width: 160px !important;',
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
    /* 메인 콘텐츠 헤더는 좌측 신호등과 겹치지 않으므로 padding 불필요 */
    /* bg-background (불투명 메인). /80 같은 투명 변형은 위에서 사이드바로 처리됨 */
    '.bg-background { background-color: #161616 !important; }',
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
    /* 클릭 가능한 요소(button, role=button, [data-state] 등)에 cursor: pointer */
    'button, [role="button"], a, summary { cursor: pointer !important; }',
    'button:disabled, [role="button"][aria-disabled="true"] { cursor: not-allowed !important; }',
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

  // ──────────────────────────────────────────────────────────
  // Cmd +/-/0 폰트 줌 (메인 콘텐츠 영역만, localStorage 영구 저장)
  // - 사이드바는 영향 안 받게 .vienna-main-content 마커 클래스로 scope 제한
  // - 가속기는 Rust에서 메뉴로 등록되어 OS 레벨에서 잡히고,
  //   여기서는 window.__vienna_apply_zoom__ 만 노출해서 메뉴가 호출함
  // - 추가로 보조 keydown 리스너도 둬서 메뉴가 늦게 붙는 경우 대비
  // ──────────────────────────────────────────────────────────
  if (!window.__vienna_zoom_installed__) {
    window.__vienna_zoom_installed__ = true;

    var ZOOM_STYLE_ID = '__vienna_zoom_style__';
    var ZOOM_KEY = 'vienna_main_zoom';
    var DEFAULT_ZOOM = 1.0;
    var MIN_ZOOM = 0.6;
    var MAX_ZOOM = 2.0;
    var ZOOM_STEP = 0.04;

    function getZoom() {
      try {
        var raw = window.localStorage.getItem(ZOOM_KEY);
        var v = raw ? parseFloat(raw) : DEFAULT_ZOOM;
        if (!isFinite(v)) return DEFAULT_ZOOM;
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
      } catch (e) { return DEFAULT_ZOOM; }
    }

    // .pwa-header-safe(메인 헤더)의 부모 또는 비-사이드바 main 컨테이너를 찾아 마커 부여
    function tagMainContentRoot() {
      var headerSafe = document.querySelector('.pwa-header-safe');
      if (headerSafe) {
        var parent = headerSafe.closest('main') || headerSafe.parentElement;
        if (parent) {
          parent.classList.add('vienna-main-content');
          return true;
        }
      }
      // fallback: <main> 태그 또는 #root > div > div:nth-child(2)
      var main = document.querySelector('main');
      if (main) {
        main.classList.add('vienna-main-content');
        return true;
      }
      return false;
    }

    function applyZoom(zoom) {
      try { window.localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) {}
      tagMainContentRoot();
      var existing = document.getElementById(ZOOM_STYLE_ID);
      var css = '.vienna-main-content, .vienna-main-content * { font-size: ' + (zoom * 100) + '% ; }'
              + '.vienna-main-content { font-size: ' + (zoom * 16) + 'px !important; }';
      if (existing) {
        existing.textContent = css;
      } else {
        var s = document.createElement('style');
        s.id = ZOOM_STYLE_ID;
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
      }
    }

    window.__vienna_zoom_state__ = { current: getZoom() };
    applyZoom(window.__vienna_zoom_state__.current);
    setTimeout(function() { applyZoom(window.__vienna_zoom_state__.current); }, 500);
    setTimeout(function() { applyZoom(window.__vienna_zoom_state__.current); }, 1500);
    setTimeout(function() { applyZoom(window.__vienna_zoom_state__.current); }, 3000);

    // SPA 내비게이션/동적 마운트 대응 (마커가 사라지면 다시 부여)
    var mainContentObserver = new MutationObserver(function() {
      if (!document.querySelector('.vienna-main-content')) {
        tagMainContentRoot();
      }
    });
    if (document.body) {
      mainContentObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Rust 메뉴 이벤트가 호출하는 진입점
    window.__vienna_apply_zoom__ = function(direction) {
      var state = window.__vienna_zoom_state__;
      if (direction === 'in') {
        state.current = Math.min(MAX_ZOOM, Math.round((state.current + ZOOM_STEP) * 100) / 100);
      } else if (direction === 'out') {
        state.current = Math.max(MIN_ZOOM, Math.round((state.current - ZOOM_STEP) * 100) / 100);
      } else if (direction === 'reset') {
        state.current = DEFAULT_ZOOM;
      }
      applyZoom(state.current);
    };

    // 보조 keydown 리스너 (메뉴 가속기가 동작하지 않는 경우 fallback)
    document.addEventListener('keydown', function(event) {
      if (!(event.metaKey || event.ctrlKey)) return;
      var k = event.key;
      var c = event.code;
      if (k === '=' || k === '+' || c === 'Equal') {
        event.preventDefault();
        window.__vienna_apply_zoom__('in');
      } else if (k === '-' || k === '_' || c === 'Minus') {
        event.preventDefault();
        window.__vienna_apply_zoom__('out');
      } else if (k === '0' || c === 'Digit0') {
        event.preventDefault();
        window.__vienna_apply_zoom__('reset');
      }
    }, true);
  }
})();
"#;

struct ServerProcess(Mutex<Option<Child>>);

fn vienna_dir() -> PathBuf {
    if let Ok(dir) = env::var("VIENNA_DIR") {
        return PathBuf::from(dir);
    }
    let home = env::var("HOME").unwrap_or_else(|_| String::from("/"));
    PathBuf::from(home).join(".vienna").join("claudecodeui")
}

fn find_node() -> String {
    // 1. VIENNA_NODE_BIN 환경변수가 있으면 우선 사용
    if let Ok(node) = env::var("VIENNA_NODE_BIN") {
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
    let dir = vienna_dir();
    let server_entry = dir.join("server").join("index.js");
    let node = find_node();

    // node 및 claude/codex/gemini 등 CLI를 찾기 위한 PATH 구성.
    // interactive shell(.zshrc 로드)을 우선 사용해 nvm/pyenv/local-bin 모두 포함.
    // login shell만 쓰면 ~/.local/bin 같은 .zshrc에서 export된 경로가 누락됨.
    let shell_path = Command::new("/bin/zsh")
        .args(["-ic", "echo $PATH"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            Command::new("/bin/zsh")
                .args(["-lc", "echo $PATH"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|| env::var("PATH").unwrap_or_default());

    // 안전하게 ~/.local/bin과 nvm 현재 버전 bin을 명시적으로 prepend
    let home = env::var("HOME").unwrap_or_default();
    let extra_paths = vec![
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    let prepended: Vec<String> = extra_paths
        .into_iter()
        .filter(|p| !shell_path.split(':').any(|existing| existing == p))
        .collect();
    let login_path = if prepended.is_empty() {
        shell_path
    } else {
        format!("{}:{}", prepended.join(":"), shell_path)
    };

    // 서버 stderr/stdout을 ~/Library/Logs/Vienna/server.log 에 기록 (디버깅용)
    let log_dir = PathBuf::from(&home).join("Library").join("Logs").join("Vienna");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("server.log");
    let stdout_target: Stdio = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    let stderr_target: Stdio = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    // 로그 분리자: 새 세션 시작 표시
    if let Ok(mut f) = File::options().append(true).create(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(
            f,
            "\n========== Vienna session started @ {:?} ==========",
            std::time::SystemTime::now()
        );
    }

    // Vienna 데이터 디렉토리 보장 (~/.vienna/auth.db 위치)
    let vienna_data_dir = PathBuf::from(&home).join(".vienna");
    let _ = std::fs::create_dir_all(&vienna_data_dir);
    let database_path = vienna_data_dir.join("auth.db");

    let mut cmd = Command::new(&node);
    cmd.arg(&server_entry)
        .current_dir(&dir)
        .env("SERVER_PORT", SERVER_PORT.to_string())
        .env("HOST", SERVER_HOST)
        .env("NODE_ENV", "production")
        .env("PATH", login_path)
        // 인증 DB는 ~/.vienna/auth.db에 저장
        .env("DATABASE_PATH", database_path);

    // Claude Agent SDK는 spawn한 child가 CLAUDECODE/CLAUDE_CODE_* 등이 보이면
    // "nested session" 에러로 즉시 exit. 부모 셸에서 새어 들어온 모든 Claude 관련
    // 환경변수를 명시적으로 제거해 SDK 내부 CLI가 깨끗한 환경에서 시작되도록 함.
    let claude_env_vars = [
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
        "CLAUDE_CODE_DISABLE_CRON",
        "CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES",
        "CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL",
        "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
        "CLAUDE_AGENT_SDK_VERSION",
        "CLAUDE_CODE_STREAM_CLOSE_TIMEOUT",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
    ];
    for var in claude_env_vars {
        cmd.env_remove(var);
    }

    cmd.stdout(stdout_target).stderr(stderr_target).spawn()
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
            // ─────────────────────────────────────────
            // 메뉴 (View > Zoom In/Out/Actual Size 가속기 등록)
            // 기본 메뉴(File/Edit/Window 등) 위에 우리 줌 항목을 추가한 View 서브메뉴를 얹는다.
            // 가속기는 OS가 잡아서 menu_event로 전달 → JS로 줌 적용.
            // ─────────────────────────────────────────
            let app_handle = app.handle();
            let pkg_info = app_handle.package_info();
            let about_metadata = AboutMetadata {
                name: Some(pkg_info.name.clone()),
                version: Some(pkg_info.version.to_string()),
                ..Default::default()
            };

            let zoom_in = MenuItem::with_id(
                app_handle,
                "vienna_zoom_in",
                "Zoom In",
                true,
                Some("CmdOrCtrl+="),
            )?;
            let zoom_out = MenuItem::with_id(
                app_handle,
                "vienna_zoom_out",
                "Zoom Out",
                true,
                Some("CmdOrCtrl+-"),
            )?;
            let zoom_reset = MenuItem::with_id(
                app_handle,
                "vienna_zoom_reset",
                "Actual Size",
                true,
                Some("CmdOrCtrl+0"),
            )?;

            #[cfg(target_os = "macos")]
            let app_submenu = Submenu::with_items(
                app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::show_all(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?;

            let edit_submenu = Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?;

            let view_submenu = Submenu::with_items(
                app_handle,
                "View",
                true,
                &[
                    &zoom_in,
                    &zoom_out,
                    &zoom_reset,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::fullscreen(app_handle, None)?,
                ],
            )?;

            let window_submenu = Submenu::with_items(
                app_handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app_handle, None)?,
                    &PredefinedMenuItem::maximize(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                ],
            )?;

            #[cfg(target_os = "macos")]
            let menu = Menu::with_items(
                app_handle,
                &[&app_submenu, &edit_submenu, &view_submenu, &window_submenu],
            )?;
            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(
                app_handle,
                &[&edit_submenu, &view_submenu, &window_submenu],
            )?;

            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                let direction = match event.id().as_ref() {
                    "vienna_zoom_in" => "in",
                    "vienna_zoom_out" => "out",
                    "vienna_zoom_reset" => "reset",
                    _ => return,
                };
                if let Some(window) = app_handle.get_webview_window("main") {
                    let js = format!(
                        "window.__vienna_apply_zoom__ && window.__vienna_apply_zoom__('{}')",
                        direction
                    );
                    let _ = window.eval(&js);
                }
            });

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

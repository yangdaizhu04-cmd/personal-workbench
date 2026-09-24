/* 个人工作台桌面版（Tauri 2）

- 系统托盘常驻：左键显示/隐藏窗口；右键菜单「显示主窗口 / 切换开机自启 / 退出」
- **关闭窗口 = 收进托盘（不退出）**：退出了就没法在关窗状态发提醒，这是后台提醒的前提
- 全局快捷键 Ctrl+K：任意界面唤出命令面板
- 后台提醒：前端把算好的「提醒清单」（绝对时间戳）推过来，本进程每 20 秒扫一次；
  **窗口可见且未最小化时不发** —— 那时前端自己会发（main.js/checkReminders），
  否则同一条提醒会前后端各响一次。窗口隐藏/最小化/已关窗时由这里发系统通知。
- 数据只在 WebView 的 localStorage 里，Rust 读不到，所以清单必须由前端推；
  清单在数据变化时防抖重推，另每 30 分钟兜底重推一次。
- 开机自启：tauri-plugin-autostart（设置页与托盘菜单都能开） */
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    AppHandle, Manager,
};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_notification::NotificationExt;

/// 一条提醒。`at` 与 `until` 都是**前端按本地时区算好的 unix 毫秒**：
/// `at` 到点提醒，`until` 是有效期（过了就作废，不再补发）。
/// Rust 侧不做任何日期推算 —— 时区、农历、业务日边界全在前端，只有一份口径；
/// 有效期也由前端给，因为"这个提醒什么时候算过期"是业务判断，不是定时器的事
#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct Reminder {
    id: String,
    at: i64,
    /// `#[serde(default)]` 是必须的：前后端版本一旦错开（改了前端忘了重建 desktop/dist），
    /// 严格结构体会让**整批**推送反序列化失败 → 后台提醒整体静默，且打包后看不到任何报错
    #[serde(default)]
    until: i64,
    title: String,
    body: String,
}

impl Reminder {
    /// 有效期缺失或算错时退回到"到点后 30 分钟"，与网页版待办提醒的窗口一致。
    /// 宁可少发，也不能因为一个字段缺失把整批提醒都丢掉
    fn effective_until(&self) -> i64 {
        if self.until > self.at {
            self.until
        } else {
            self.at + 30 * 60 * 1000
        }
    }
}

#[derive(Default)]
struct ReminderState {
    list: Mutex<Vec<Reminder>>,
    /// 已发过的 id（免得 20 秒一轮里同一条反复弹）
    fired: Mutex<HashSet<String>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 收到清单时顺手在应用数据目录写一份 `reminders.json`。
/// 它不参与提醒逻辑（清单靠前端每 30 分钟重推），只是排障用的"最后收到的那份"——
/// 排查"关窗后到底有没有提醒"时有这一个文件就能分清是前端没推还是没发出去
fn write_diag(app: &AppHandle, list: &[Reminder]) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(list) {
            let _ = std::fs::write(dir.join("reminders.json"), json);
        }
    }
}

/// 前端推清单（数据变化时防抖推一次；后台提醒开关关掉时推空数组）
#[tauri::command]
fn set_reminders(
    app: AppHandle,
    state: tauri::State<'_, ReminderState>,
    list: Vec<Reminder>,
) -> usize {
    let n = list.len();
    if let Ok(mut guard) = state.list.lock() {
        *guard = list.clone();
    }
    write_diag(&app, &list);
    n
}

/// 自检：立刻发一条通知，让用户确认系统真的能弹出来（比"理论上应该能"靠谱）
#[tauri::command]
fn test_notify(app: AppHandle) -> Result<String, String> {
    app.notification()
        .builder()
        .title("个人工作台")
        .body("通知是通的 —— 关掉窗口也能收到提醒 ✓")
        .show()
        .map(|_| "已发出，看看屏幕右下角".to_string())
        .map_err(|e| format!("系统没让发：{e}"))
}

/// 前端是否在"看得见"的状态：可见且未最小化才算看得见。
/// 最小化时 Windows 的 is_visible 仍是 true，但用户其实看不到通知该由后台补。
fn front_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// 每发一条通知追加一行到 `fired.log`（应用数据目录）。
/// 排障时这一个文件就能分开三种情况：没触发（没有行）/ 系统拒了（err）/ 系统收下了（ok）。
/// 关窗之后没有任何界面可以看，没有这个日志就只剩猜
fn log_fired(app: &AppHandle, r: &Reminder, err: Option<String>) {
    use std::io::Write;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let line = format!(
            "{} | {} | {} | {}\n",
            now_ms(),
            r.id,
            if err.is_none() { "ok" } else { "err" },
            err.unwrap_or_default()
        );
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("fired.log"))
        {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

fn spawn_reminder_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20));
        if front_visible(&app) {
            continue;
        }
        let state = app.state::<ReminderState>();
        let now = now_ms();
        let due: Vec<Reminder> = match state.list.lock() {
            Ok(list) => list
                .iter()
                // 到点且还在有效期内才发：过了有效期就不再补发（重开工作台时
                // 不会把几天前的陈提醒一股脑弹出来），有效期由前端按类型给
                .filter(|r| r.at <= now && now <= r.effective_until())
                .cloned()
                .collect(),
            Err(_) => continue,
        };
        for r in due {
            {
                let mut fired = match state.fired.lock() {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if fired.contains(&r.id) {
                    continue;
                }
                fired.insert(r.id.clone());
                if fired.len() > 400 {
                    fired.clear(); // 去重表别无限长大（清空最坏只是重发一次当轮提醒）
                }
            }
            let sent = app
                .notification()
                .builder()
                .title(&r.title)
                .body(&r.body)
                .show()
                .map(|_| ())
                .map_err(|e| e.to_string());
            log_fired(&app, &r, sent.err());
        }
    });
}

fn toggle_autostart(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let m = app.autolaunch();
    match m.is_enabled() {
        Ok(true) => {
            let _ = m.disable();
        }
        _ => {
            let _ = m.enable();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ReminderState::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+k"])
                .unwrap()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            // 通知前端打开命令面板
                            let _ = win.eval(
                                "if(window.WB&&WB.commands&&WB.commands.open){WB.commands.open();}",
                            );
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![set_reminders, test_notify])
        .setup(|app| {
            // 托盘右键菜单。左键仍然是"显示/隐藏"（见下面 on_tray_icon_event）
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let auto_item = MenuItem::with_id(app, "autostart", "切换开机自启", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出（不再提醒）", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &PredefinedMenuItem::separator(app)?,
                    &auto_item,
                    &quit_item,
                ],
            )?;

            let tray = TrayIconBuilder::with_id("wb-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("个人工作台 · 晨雾奶油")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "autostart" => toggle_autostart(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            let _ = tray;

            /* 关窗 = 收进托盘。**不这么做后台提醒就不成立**：
               窗口一销毁，WebView 里的 JS 全停，托盘也再无入口可以唤回窗口 */
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            spawn_reminder_loop(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/* 个人工作台桌面版（Tauri 2）
   - 系统托盘常驻：左键显示/隐藏窗口
   - 全局快捷键 Ctrl+K：任意界面唤出命令面板（聚焦窗口）
   - 开机自启：由 tauri-plugin-autostart 提供（设置里可用 CLI 或打包后加开关） */
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    tray::{TrayIconBuilder, MouseButton, MouseButtonState},
    Manager,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::Launchd,
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
                            let _ = win.eval("if(window.WB&&WB.commands&&WB.commands.open){WB.commands.open();}");
                        }
                    }
                    Ok(())
                })
                .build(),
        )
        .setup(|app| {
            // 托盘：左键切换显示
            let tray = TrayIconBuilder::with_id("wb-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("个人工作台 · 晨雾奶油")
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

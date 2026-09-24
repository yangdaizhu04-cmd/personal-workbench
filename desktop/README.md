# 桌面 App（Tauri 2）打包指南

> 产出 Windows 可执行文件（`target/release/personal-workbench.exe`，59.6 MB）与安装包。
> **打包是可选产物**，不影响浏览器版使用。
> 桌面版能力：系统托盘常驻、全局快捷键 Ctrl+K 唤出命令面板、开机自启、独立窗口、
> **关掉窗口后仍在托盘里按点提醒（待办到点 / 倒数日与生日 / 晨间 / 收工）**。

## 本仓库已备好的物料

```
desktop/
├── dist/                     # 前端产物（node build.js --tauri 生成，已 gitignore）
└── src-tauri/
    ├── tauri.conf.json       # 窗口 / 托盘 / withGlobalTauri / 前端目录指向 ../dist
    ├── capabilities/
    │   └── default.json      # Tauri 2 权限：core + notification + autostart
    ├── Cargo.toml            # tauri 2 + global-shortcut + autostart + notification
    ├── build.rs
    └── src/main.rs           # 托盘 + 快捷键 + 关窗收托盘 + 后台提醒线程 + 两个命令
```

## 打包步骤（本机已装 Rust 1.98 / Node 20+）

```bash
# 1. 先生成前端产物（**每次改了前端代码都必须重跑这一步**）
node build.js --tauri            # 写入 desktop/dist/（含场景视频/窗景/3D 书架）

# 2. 编译
cd desktop/src-tauri
cargo build --release            # 只出 exe：target/release/personal-workbench.exe
# 或要安装包：cd desktop && npx -y @tauri-apps/cli@2 build   → target/release/bundle/

# 3. 图标（仅在需要重做图标时）
npx @tauri-apps/cli icon ../assets/icon.svg
```

## 桌面版行为约定（改之前先读这段）

| 行为 | 说明 |
|---|---|
| 点 × 关闭窗口 | **收进托盘，不退出**（`CloseRequested` → `prevent_close` + `hide`）。退出了就没法在关窗状态发提醒 |
| 真正退出 | 托盘图标**右键 → 退出**。托盘左键仍是显示/隐藏窗口 |
| 快捷键 Ctrl+K | 唤出窗口并打开命令面板 |
| 开机自启 | 托盘右键「切换开机自启」或设置页「桌面版」分区开关（`tauri-plugin-autostart`） |
| 后台提醒 | 前端把「提醒清单」推给 Rust（`set_reminders` 命令），后台线程每 20 秒扫一次；**窗口可见且未最小化时不发**（那时前端自己会发，避免一条提醒响两次） |
| 前端↔Rust 分工 | 待办到点 / 倒数日与生日 / 晨间 / 收工：可见时前端发、隐藏时 Rust 发；番茄结束始终归前端 |

## 排障用的两个文件（在 `%APPDATA%\com.personal.workbench\`）

| 文件 | 看什么 |
|---|---|
| `reminders.json` | **最后收到的那份提醒清单**。没有这个文件 = 前端根本没推上来（前端产物没更新？） |
| `fired.log` | 后台线程每发一条通知追加一行：时间戳 \| id \| `ok`/`err` \| 错误信息。`err` = 系统拒了，`ok` = 系统收下了 |

## 已知注意事项

- **改了 `js/` 里任何前端代码，必须重跑 `node build.js --tauri`**：`cargo build` 只编 Rust，
  不会同步前端。不重跑的下场是跑着旧 JS，而且前后端版本错开时提醒会静默失效（踩坑 #076）。
- Windows 通知对**未安装**的程序有时不显示（没有开始菜单快捷方式时，toast 可能被系统忽略）。
  用设置页「桌面版 → 通知自检」立刻验证一次；不显示就 `npx tauri build` 出安装包装一遍。
- 提示音/焦点助手：专注助手开启时通知会被静音，这属于系统行为。
- Electron 备选方案：把 `desktop/src-tauri` 换成 Electron 主进程脚本加载 `desktop/dist/index.html`
  即可，业务代码零改动。

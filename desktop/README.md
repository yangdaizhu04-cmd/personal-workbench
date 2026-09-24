# 桌面 App（Tauri 2）打包指南

> 产出 Windows 可执行文件（`target/release/personal-workbench.exe`，59.6 MB）与安装包。
> **打包是可选产物**，不影响浏览器版使用。
> 桌面版能力：系统托盘常驻、全局快捷键 Ctrl+K 唤出命令面板、开机自启、独立窗口、
> **关掉窗口后仍在托盘里按点提醒（待办到点 / 倒数日与生日 / 晨间 / 收工）**。

## 本仓库已备好的物料

```
desktop/
├── dist/                     # 前端产物（node build.js --tauri 生成，已 gitignore）
├── toast.html                # 提醒卡（便携模式下代替系统通知；由 build.js --tauri 拷进 dist）
└── src-tauri/
    ├── tauri.conf.json       # 窗口 / 托盘 / withGlobalTauri / 前端目录指向 ../dist
    ├── capabilities/
    │   └── default.json      # Tauri 2 权限：core + notification + autostart（windows: main + toast）
    ├── Cargo.toml            # tauri 2 + global-shortcut + autostart + notification + single-instance
    ├── build.rs
    └── src/main.rs           # 托盘 + 快捷键 + 关窗收托盘 + 后台提醒线程 + 提醒通道 + 四个命令
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
| 单实例 | 重复启动只会把已有窗口叫到前面（`tauri-plugin-single-instance`）——否则开机自启 + 手动双击会变成两个托盘 + 同一条提醒弹两次 |

## 提醒走哪条通道（重要，别改错）

**"能发通知"不等于"能看见通知"。** Windows 的系统通知要求程序有 AUMID 身份，那通常由安装包建的
开始菜单快捷方式提供；直接跑 `target\release` 的 exe 没有它，`tauri-plugin-notification` 会因此
**故意不设置 app_id**，`notify-rust` 退回用 `Toast::POWERSHELL_APP_ID` 发送，而新版 Windows 已经没有
「Windows PowerShell」快捷方式了 → **通知被系统静默丢掉，而 `show()` 仍返回 Ok**。

所以：

| 情况 | 通道 |
|---|---|
| 便携运行（在 `target\release` 里跑） | **提醒卡**（`toast.html`：360×138 无边框置顶，右下角，9 秒自动收，点一下唤出主窗口） |
| 真的装过（开始菜单有 `个人工作台.lnk`） | 系统通知（进通知中心、尊重「专注助手」），发不出去才回落提醒卡 |
| 只是把 exe 拷到别处 | 提醒卡（`installed()` 找不到快捷方式） |

另：系统通知总开关（设置 → 系统 → 通知）关掉时**任何应用都弹不出**，应用侧无法感知 ——
自检按钮会说明用的是哪条通道，`fired.log` 的末列也记（`ok | card` / `ok | system` / `err | …`）。

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
- 提示音/焦点助手：专注助手开启时通知会被静音，这属于系统行为；提醒卡不受专注助手影响（这是取舍）。
- **托盘出现"幽灵图标"**：用 `Stop-Process -Force` 强杀的进程，Windows 不会回收它的托盘图标
  （鼠标划过或重启资源管理器才消失）。遇到"图标多了"先 `Get-Process personal-workbench` 数进程，别急着改代码。
- 重新编译前**先退出正在运行的实例**（托盘右键 → 退出），否则 `cargo build` 会报
  `failed to remove file ... 拒绝访问`。
- Electron 备选方案：把 `desktop/src-tauri` 换成 Electron 主进程脚本加载 `desktop/dist/index.html`
  即可，业务代码零改动。

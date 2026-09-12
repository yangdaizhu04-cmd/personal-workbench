# 桌面 App（Tauri 2）打包指南

> 产出 Windows 安装包（.exe / .msi）。**打包是可选产物**，不影响浏览器版使用。
> 桌面版能力：系统托盘常驻、全局快捷键 Ctrl+K 唤出命令面板、开机自启、独立窗口。

## 本仓库已备好的物料

```
desktop/src-tauri/
├── tauri.conf.json   # 窗口/托盘/前端目录指向 ../cloud/hosting（单文件构建产物）
├── Cargo.toml        # 依赖：tauri 2 + global-shortcut + autostart
├── build.rs
└── src/main.rs       # 托盘 + 全局快捷键逻辑
```

## 打包步骤（需 Rust 环境，本开发机未装 Rust，故留待执行）

1. 安装 Rust（https://rustup.rs）与 Visual Studio Build Tools（Windows）
2. 安装 Tauri CLI：`npm i -g @tauri-apps/cli@latest`（或 cargo install tauri-cli）
3. 生成应用图标（用项目 SVG 生成各尺寸）：
   ```
   cd desktop
   npx @tauri-apps/cli icon ../assets/icon.svg   # 先准备 assets/icon.svg
   ```
4. 打包：
   ```
   cd desktop
   npx tauri build
   ```
   产物在 `desktop/src-tauri/target/release/bundle/` 下（msi / nsis .exe）。

## 已知注意事项

- `tauri.conf.json` 的 `frontendDist` 指向 `../cloud/hosting`：先跑 `node build.js --cloud`
  生成单文件产物，再打包桌面版（同一份代码、同一个数据层）。
- 全局快捷键默认 `Ctrl+K`，与网页内快捷键一致，唤起后前端自动打开命令面板。
- 开机自启：打包后可在 Windows「任务管理器 → 启动应用」管理，或后续把
  autostart 插件的开关接到设置页（接口已留：`tauri-plugin-autostart`）。
- Electron 备选方案：如需 Electron（体积更大但无需 Rust），把 `desktop/src-tauri`
  换成 Electron 主进程脚本加载 `cloud/hosting/index.html` 即可，业务代码零改动。

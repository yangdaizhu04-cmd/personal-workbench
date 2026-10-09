# 移动端图标 / 启动屏资源

放置 App 图标与启动屏的**源文件**，由 `@capacitor/assets` 工具生成各尺寸（`mipmap-*` / `drawable-*`）。

## 图标 icon

- 源文件：`icon.png`（1024×1024，方形，无圆角 —— Android 自适应图标由工具裁切）
- 建议：沿用桌面版「晨」窗图标（`desktop/src-tauri/icons/`），保持一致视觉。

## 启动屏 splash

- 源文件：`splash.png`（2732×2732，居中图案，四周留白）
- 背景色：奶油底 `#f6f1e7`（与 `capacitor.config.json` 的 `backgroundColor` 一致），避免启动白闪。

## 生成命令

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate --android   # 在 mobile/ 目录下执行
```

生成后 `npx cap sync android` 同步进工程。

---

（当前为占位说明；源文件待 A 批落地时放置。）

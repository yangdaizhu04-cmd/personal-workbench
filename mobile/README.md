# 移动端 App（Capacitor 8）工程说明

> 个人工作台 · 移动端独立分支：**Capacitor 8 套壳，Android only + 侧载 APK（不上架）**。
> 与桌面版（`desktop/`）对称：`mobile/` 放原生壳与配置，`js/19-app.js` 放前端桥（对应 `js/18-desktop.js`）。
> 定位：**App 是纯增量**，网页版 / PWA / 桌面 / 扩展行为一律保持不变。

## 1. 关键决策（已与用户确认）

| 项 | 结论 |
|---|---|
| 套壳 | Capacitor 8，Android only，侧载 APK |
| 范围 | **全量档**（含 38.7MB 沉浸视频 + 3D 书架 + 动态壁纸，与桌面版资源一致） |
| 云同步 / AI | 默认关闭（需部署 CloudBase 才激活，与网页版同口径） |
| 后台环境音 | **退后台暂停、回前台恢复**（不做前台服务保活；番茄计时本就时间戳制，重开自动恢复） |
| 真机 | OPPO Find X8s+（12G 运存 / 512G 存储），USB 调试 + 端到端实测 |

## 2. 目录结构

```
mobile/
├── README.md                # 本文件：工程规范 / 构建 / 依赖 / 版本控制
├── 踩坑记录.md               # 移动端踩坑记录（M01 起编号，与根目录「开发踩坑.md」的 # 系列独立）
├── .gitignore               # 移动端专属忽略规则（dist / android 构建产物 / keystore）
├── capacitor.config.json    # Capacitor 配置（appId / webDir / android 参数）
├── assets/
│   └── README.md            # 图标 / 启动屏源文件与规格
├── dist/                    # App web 产物（`node build.js --app` 生成，gitignore）
└── android/                 # Android 原生工程（`npx cap add android` 生成；源码入库，build 产物忽略）
```

**不在 mobile/ 里的移动端内容**（遵循项目既有「形态隔离」约定，与桌面版 `18-desktop.js` 对称）：

| 位置 | 内容 |
|---|---|
| `js/19-app.js` | App 前端桥：封装 Capacitor 插件，Web 下全 no-op（唯一原生出口） |
| `js/01-utils.js` | `WB.env.mode` 形态判定矩阵（收口 5 种形态的布尔组合） |
| `build.js` | 根构建脚本，新增 `--app` 分支（esbuild `define` 注入 `__WB_APP__` + 全量拷贝到 `mobile/dist`） |
| `index.html` | 加一行 `<script src="js/19-app.js">`（排在 `18-desktop.js` 之后、`main.js` 之前） |

## 3. 技术栈与依赖

- **Node ≥ 21**、**JDK 21**（`JAVA_HOME`，注意 PATH 里默认 `java` 是 25，构建必须走 21）、**Android SDK 36**（`platforms/android-36` + `build-tools/36.0.0`）、**Android Studio**
- 核心：`@capacitor/core@8` / `@capacitor/cli@8` / `@capacitor/android@8`
- 插件（按批次引入，A 批先装前三者 + `app` / `status-bar` / `splash-screen`）：
  | 插件 | 批次 | 用途 |
  |---|---|---|
  | `@capacitor/app` | A | 返回键 / 生命周期 / appState |
  | `@capacitor/status-bar` | A | 状态栏配色（跟随主题） |
  | `@capacitor/splash-screen` | A | 启动屏（防白屏闪） |
  | `@capacitor/preferences` | B | localStorage 镜像落盘 |
  | `@capacitor/filesystem` | B | 本地音乐迁原生 / 快照写私有目录 |
  | `@capacitor/share` | B | 系统分享导出 / 导入 |
  | `@capacitor/local-notifications` | C | 到点提醒（绝对时间调度） |
  | `@capacitor/keep-awake` | C | 番茄钟屏幕常亮 |
  | `@capacitor/haptics` | D | 触觉反馈 |

## 4. 构建流程（命令链固定，漏第一步的症状是「代码写了没生效」）

```bash
# ① 生成 App web 产物（全量拷贝 + __WB_APP__=true 注入）—— 每次改 js/ 都必须重跑
node build.js --app

# ② 同步 web 资源与插件到 android 工程
cd mobile && npx cap sync android

# ③ 打包 debug APK
cd mobile/android && gradlew.bat assembleDebug
# 产物：mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

已串成一条：`npm run apk`（= `node build.js --app && cd mobile && npx cap sync android && cd android && gradlew.bat assembleDebug`）。

- **首次**需先 `npx cap add android` 生成 `mobile/android/`（已提交仓库则跳过）。
- **release 签名**：侧载用 debug keystore 可装；稳定覆盖安装需自建 keystore（见 §5）。

## 5. 版本控制策略（硬规矩）

1. **入库**：`mobile/capacitor.config.json`、`mobile/assets/`、`mobile/android/` 的源码（含 `build.gradle`、`AndroidManifest.xml`、`capacitor.build.gradle` 等）、`js/19-app.js`。
2. **忽略**：`mobile/dist/`、`mobile/android/` 的 `build/`/`.gradle/`/`local.properties`、`node_modules/`。
3. **keystore 绝不入库**：签名文件放仓库外并有备份；**丢失 = 无法覆盖安装 = 用户必须卸载重装 = 数据全丢**。这是比任何代码 bug 都致命的一条。
4. **提交节奏**：每批验证通过后本地 `git commit`（沿用仓库风格：中文 + 类型前缀，如 `feat(app): …`），最后统一 push（见根仓库约定）。
5. **临时文件纪律**：真机联调产生的临时探针脚本、截图、中间产物一律用完即删，不入库。

## 6. 代码规范

1. **`__WB_APP__` 是唯一 App 形态标记**（编译期裸标识符，`build.js --app` 用 esbuild `define` 注入 `true`，其余分支注入 `false`；死分支会被 minify 消除）。所有 App 专属差异只写 `if (__WB_APP__) {...}` 或 `__WB_APP__ ? A : B`，**禁止新造第二套判断**。
2. **`js/19-app.js` 是唯一原生出口**：网页版 / PWA / 桌面 / 扩展里它整体 no-op。App 里也**不直接** `Capacitor.Plugins.*`，一律经 `WB.app.*` 封装，封装内部做「插件不可用 / 权限被拒 → 降级回 Web 行为」。
3. **形态判定只看 `WB.env.mode`**（在 `01-utils.js` 固化），不裸写 `isFile` / `inTauri` / `__WB_APP__` 组合。5 种形态：`folder` / `single` / `pwa` / `desktop` / `app`。
4. **前端不许自己 `new Notification()`**（沿用桌面版 #079 教训）：App 里走 `WB.notify()` → `19-app.js` → Local Notifications。
5. **App 能力全部可降级**：任何原生调用 `catch` 后回落 Web 行为并给一句可恢复提示，绝不因原生失败而白屏 / 抛错。
6. 代码风格 / lint 沿用根项目 `oxlint`（`npm run lint`），不另立规则。

## 7. 行为约定（改之前先读）

| 行为 | 说明 |
|---|---|
| 返回键 | 逐层关闭浮层（modal / 抽屉 / cmdk / 沉浸层 / 窗景 / 书架），到底层「今日」再按则退到后台（`App.minimizeApp` 或退出，待真机定）；**不直接杀进程** |
| edge-to-edge | Android 15 强制；策略 = **透明状态栏 + 顶栏按 `safe-area-inset-top` 留白**，状态栏文字色随主题深浅切换 |
| 后台 | 番茄计时时间戳制，退后台照走、重开恢复；环境音退后台暂停、回前台恢复；到点提醒走 Local Notifications 绝对时间 |
| 数据 | localStorage 文字数据 + IndexedDB 大文件，B 批加原生落盘（Preferences / Filesystem / 系统分享）；App 卸载/清数据前用户需靠「导出分享」带走 |
| 云同步 | 默认关闭；`14-cloud.js` 在 App 里 `cloudBaseUrl` 为空 → 静默，不误触发 |

## 8. 排障入口

| 手段 | 看什么 |
|---|---|
| `adb logcat` | 过滤 `Capacitor` / `chromium` / `AndroidRuntime`，看 WebView 控制台与原生崩溃 |
| `chrome://inspect` | 连接真机 WebView 调试前端（开发者选项 → USB 调试 + 电脑 Chrome） |
| `adb shell` + `run-as com.personal.workbench` | 看应用私有目录（Preferences / Filesystem 落盘产物） |
| 设置页「关于」 | App 版显示 `versionName` / `versionCode` / 形态 `app` |

## 9. 待办 / 未决（随批次推进更新）

- [x] **A 批完成（2026-10-09）**：真机冒烟通过 —— OPPO PLB110 / Android 16（SDK 36）：侧载安装、启动无崩溃无 JS 错误、首屏渲染（奶油主题/晨间仪式/天气联网）、**返回键关弹窗且 App 不退出**、**无弹窗时退后台进程存活**、**深浅色切换状态栏实时跟随**、底栏/抽屉/路由正常
- [x] A 批：返回键到底层的行为 → 真机已定 = `minimizeApp()` 退后台、进程存活（番茄计时时间戳制照走）
- [x] **B 批核心完成（2026-10-09）**：① Preferences 镜像（`js/20-appdata.js`：数据导入后防抖 + 每 60s 兜底 + **退后台走 `app:state`**，真机验证 `shared_prefs/CapacitorStorage.xml` 落盘、敏感键/netcache 正确剔除；本机空时启动自动恢复）；② 系统分享导出（`downloadFile` 加 App 分支 → `saveAndShare`：Filesystem(CACHE) + Share，JSON/MD/CSV/zip 全走通，真机验证分享面板弹出「个人工作台备份-2026-10-09.json」）。新增插件 preferences / filesystem / share
- [x] **B 二阶段完成（2026-10-10）**：**本地音乐迁原生 Filesystem** —— 新增 `WB.musicFile` 抽象层（`20-appdata.js`，所有形态挂载：Web 委托 IndexedDB 行为不变、App 走 `Filesystem(DATA)/music/<id>.<ext>`，写失败自动降级回 IndexedDB）；`sound.js` 导入/播放两处改走它（运行时调用无时序问题）。**封面/涂鸦/照片主题刻意不迁**：均为几十 KB 小图片且可重新生成，IndexedDB 无配额压力，迁移成本大于收益（防卸载靠 B 批的分享导出）。真机 UI 验证（导入+播放）待手机解锁后补
- [ ] B 批遗留：封面/涂鸦/照片主题如需原生落盘，走通用 idb 镜像方案（key↔文件名映射需 base64 编码）
- [x] **C 批完成（2026-10-10）**：① **到点提醒** —— `20-appdata.js` 用 Local Notifications 绝对时间调度（走系统 AlarmManager，App 退后台/被杀也能触发）；清单口径**复用 `18-desktop.js` 的 `buildList`**（纯函数、平台无关）、去重复用同一套 `fired` 记账键；只排未来时刻（到点仍在有效期内的归前台 `checkReminders`）；通知 id 用哈希从字符串 rid 派生；`allowWhileIdle` 让 Doze 下也能到点；点击通知按 rid 前缀跳页。② **屏幕常亮** —— 用 **Screen Wake Lock API**（`navigator.wakeLock`，**无需插件**；官方 `@capacitor/keep-awake` 已从 npm 下架），跟随 `pomo:phase`（计时中常亮）。③ **环境音退后台暂停/回前台恢复** —— 复用 `app:state`，只在退后台确实在播才记标记、才恢复；只动环境音七路，本地音乐/音频库不碰。新增插件 `@capacitor/local-notifications`（权限 POST_NOTIFICATIONS / SCHEDULE_EXACT_ALARM / RECEIVE_BOOT_COMPLETED 由插件清单自动合并）
- [x] **C 批真机验证完成（2026-10-10，OPPO PLB110 / Android 16）**：① 通知 —— `dumpsys alarm` 见 3 个 `RTC_WAKEUP` 闹钟（`TimedNotificationPublisher`，时间戳解码正是明天 8:00 晨间 / 18:00 收工 / 后天 8:00 晨间，与 `buildList` 一致），加一条「19:13 准点」待办后 `dumpsys notification` 见 `android.text=String (现在：notifytest)` —— **通知实际弹出** ✅；② 屏幕常亮 —— 番茄专注中 `dumpsys window` 见窗口 `fl=KEEP_SCREEN_ON`、`mHoldScreenWindow` 指向 App ✅；③ 环境音 —— `dumpsys audio` 见播放器 `started`（前台）→ `stopped`（切后台）→ `started`（回前台）✅
- [ ] C 批遗留：精确闹钟（SCHEDULE_EXACT_ALARM）在 Android 12+ 是特殊权限，未授予时到点可能不准（必要时加设置页引导）；到点提醒的"锁屏/免打扰下是否显示"未专项验证
- [ ] D 批：启动屏自定义资源（当前用系统默认；`assets/` 已留规格说明）
- [ ] E 批（可选）：云同步联调 / 应用内检查更新 / 系统分享收文本

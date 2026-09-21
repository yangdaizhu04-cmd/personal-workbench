# vendor/video —— 沉浸专注层的循环视频背景

四支短片只在**沉浸专注层**里播放（`js/16-immersive.js`）：进入沉浸才加载、退出即停并释放；单文件版与 `html.no-motion` 一律不加载，回落 CSS 场景。

全部 **1920×1080 / 24fps / 无音轨 / 正向无缝循环**，合计 **14.12 MB**。
（v1 曾是 720p + 波折循环，因「放大偏软 + 倒带感」重做；v2 的篝火/星野又因「冲击力不足」更换，见开发踩坑 #050。）

## 清单与来源

| 场景文件 | 原始素材 | Mixkit 素材页 | 原片直链 |
|---|---|---|---|
| `mist.mp4`（晨雾·10s·1.36MB） | 28339 · Forest covered by mist at sunrise from the heights | https://mixkit.co/free-stock-video/forest-covered-by-mist-at-sunrise-from-the-heights-28339/ | `https://assets.mixkit.co/videos/28339/28339-1080.mp4` |
| `deep.mp4`（深海·5.4s·2.22MB） | 4291 · School of fish swimming | https://mixkit.co/free-stock-video/school-of-fish-swimming-4291/ | `https://assets.mixkit.co/videos/4291/4291-1080.mp4` |
| `ember.mp4`（篝火·9s·5.88MB） | 52304 · Flames suddenly burst and intertwine over a black background | https://mixkit.co/free-stock-video/flames-suddenly-burst-and-intertwine-over-a-black-background-52304/ | `https://assets.mixkit.co/videos/52304/52304-1080.mp4` |
| `star.mp4`（星野·4.6s·4.67MB） | 4034 · Beautiful northern lights of yellow and pink tones | https://mixkit.co/free-stock-video/beautiful-northern-lights-of-yellow-and-pink-tones-4034/ | `https://assets.mixkit.co/videos/4034/4034-1080.mp4` |

挑选标准（v3 定稿）：实拍自然素材、构图上没有会与中央数字打架的小主体、暗部占比高（浅色文字可读）、动作慢但形态有张力。篝火/星野两支是 v2 后按「视觉冲击力」专项重选的。

**备选**（想换口味时一条命令即可，见下方处理链路）：篝火可用 `52284`（黑底火带，优雅一些；当时 CDN 限流没下到 1080p）；星野可用 `4033`（山谷间的绿极光）、`4036`（紫色极光，更暗更含蓄）、`4148`（银河+山脊）；深海可用 `1078`（俯拍海浪拍岸）。

## 授权（Mixkit Stock Video **Free** License）

- 四支素材页的结构化元数据均为：`"copyrightNotice":"Free"`、`"isAccessibleForFree":true`、`"license":"https://mixkit.co/license/#videoFree"`，且**未命中 `Restricted` 档**。
- Mixkit 站点自述原文：`Mixkit is a free resource hub providing high-quality video clips, music tracks, and sound effects for creators, offering carefully curated assets that can be used in commercial and personal projects without attribution.`
- 完整条款：https://mixkit.co/license/#videoFree （条款正文由前端渲染，静态抓取不到，请以浏览器打开为准）。
- **它不是 CC0**：可免费商用、免署名，但**不得把素材本身当作素材库再分发/转售**。本目录是「项目自带资源」，属正常使用；若日后要单独抽出 `vendor/video/` 分发，请重新确认。

## 处理链路（可复现）

1080p 原片 7~46 秒不等。两个关键决定：

1. **正向无缝循环，不用波折（boomerang）**：正放+倒放会让雾、火、水出现明显的"倒带感"（v1 被用户指出"不真实"的主因之一）。改用 `xfade` 把**结尾与开头交叉溶解**——输出最后 F 秒是"尾部 → 头部"的渐变，循环点两侧画面连续：
   ```bash
   # T=成片长度, F=溶解时长(2~2.5s)；head 取自片段开头
   ffmpeg -y -ss {start} -t {T+0.5} -i {id}-1080.mp4 -filter_complex "\
     [0:v]scale=-2:1080:flags=lanczos,fps=24,hqdn3d=1.2:1.2:2:2,split[a][b];\
     [a]trim=0:{T},setpts=PTS-STARTPTS[main];\
     [b]trim=0:{F},setpts=PTS-STARTPTS[head];\
     [main][head]xfade=transition=fade:duration={F}:offset=$({T}-{F})[out]" \
     -map "[out]" -an -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
     -crf {24~26} -tune film -preset veryslow -movflags +faststart {scene}.mp4
   ```
   源片太短时（deep 7.4s / star 7.1s）只能做 5 秒左右的成片，把溶解段加长到 2.4~2.5s 可以让循环更看不出接缝。
2. **夜空/火焰素材必须时域降噪**：极光原片 ISO 噪点极重，CRF 23 直接编码 5 秒要 10.6MB；`hqdn3d=4:4:8:8` 后降到 4.67MB，画面反而更干净（固定机位的夜空，时域降噪零副作用）。火焰噪点也多，`hqdn3d=2:2:4:4` + CRF 27 从 7.1MB 压到 5.88MB。

其余：`-tune film` 保留胶片颗粒感；`-movflags +faststart` 让边下边播；下载必须带 `Referer: https://mixkit.co/` + 浏览器 UA（防盗链，裸 curl 连接直接失败返回 000）。**该站对同一 IP 有突发限流**——连续下几百 MB 后所有请求都会 000，等几分钟自动恢复；单支下载之间隔 8~10 秒最稳。

## 运行时行为

- **不写进 Service Worker 预缓存清单**（`sw.js` 的 `SHELL` / `build.js` 的 shell 数组）：安装包轻一点，首播时由 SW 的 fetch 处理器顺手缓存，之后离线可用。
- 文件缺失 / 解码失败 / 离线首访：`error` 事件后该场景当次会话不再重试，画面仍是 CSS 场景——**视频永远是叠加层，不是唯一底**。
- 视频播放时 `#focus-stage.has-video` 会：停掉场景自带的 CSS 动态层（省 GPU）、把 `.fs-veil` 降到 68%（别洗掉 1080p 的细节）、亮起 `.fs-halo`（数字区与上下控件区的可读性雾，颜色取各场景 `--fs-halo`，与文字色反极性）。
- **篝火在视频态会翻转整套配色极性**（`#focus-stage.has-video[data-scene="ember"]`）：黑底亮火的素材配浅色字 + 深色光晕才读得清；晨雾/深海两支保持原极性。**给某个场景换素材后，先截图看明暗极性对不对，再决定要不要加这条翻转。**

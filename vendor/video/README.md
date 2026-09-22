# vendor/video —— 沉浸专注层的循环视频背景

四支短片只在**沉浸专注层**里播放（`js/16-immersive.js`）：进入沉浸才加载、退出即停并释放；单文件版与 `html.no-motion` 一律不加载，回落 CSS 场景。

全部 **1920×1080 / 24fps / 无音轨 / 正向无缝循环**，合计 **12.70 MB**。
（v1 曾是 720p + 波折循环，因「放大偏软 + 倒带感」重做；v2 的篝火/星野因「冲击力不足」换成黑底满屏火焰与黄绿极光（踩坑 #050）；**v4（2026-09-22）**用户评价篝火/星野「效果很不好」后再次更换：篝火由「火焰特写怼满全屏」换成**室内壁炉暖光**（2707），星野由「黄绿浑浊极光」换成**银河 + 锯齿山脊**（4148）。）

## 清单与来源

| 场景文件 | 原始素材 | Mixkit 素材页 | 原片直链 |
|---|---|---|---|
| `mist.mp4`（晨雾·10s·1.36MB） | 28339 · Forest covered by mist at sunrise from the heights | https://mixkit.co/free-stock-video/forest-covered-by-mist-at-sunrise-from-the-heights-28339/ | `https://assets.mixkit.co/videos/28339/28339-1080.mp4` |
| `deep.mp4`（深海·5.4s·2.22MB） | 4291 · School of fish swimming | https://mixkit.co/free-stock-video/school-of-fish-swimming-4291/ | `https://assets.mixkit.co/videos/4291/4291-1080.mp4` |
| `ember.mp4`（篝火·8s·3.41MB） | 2707 · A fireplace lit at Christmas time（屋内关灯、壁炉火光为唯一光源） | https://mixkit.co/free-stock-video/a-fireplace-lit-at-christmas-time-2707/ | `https://assets.mixkit.co/videos/2707/2707-1080.mp4` |
| `star.mp4`（星野·8s·5.71MB） | 4148 · Milky way seen at night（银河 + 山脉剪影） | https://mixkit.co/free-stock-video/milky-way-seen-at-night-4148/ | `https://assets.mixkit.co/videos/4148/4148-1080.mp4` |

挑选标准（v4 定稿）：实拍自然素材、构图上没有会与中央数字打架的小主体、暗部占比高（浅色文字可读）、动作慢但形态有张力。**v4 教训**：Mixkit 篝火分类里「高质量夜景实拍」（树林营火/夜空篝火）几乎全被划入 Restricted 档（仅个人使用、无 1080 免费直链），Free 档可选面小——已核实不可用的 Restricted 素材：47818、47311、31352、31466、21855、30253（详见踩坑 #051）。

**备选**（Free 档、已核实授权与画面，想换口味时一条命令即可）：
- 篝火：51633（后院火盆 + 躺椅环境，构图偏左下）、51634（林中烟雾 + 飞舞火星，最暗最宁静但火堆在画面外）
- 星野：4124（银河横贯上半部 + 平缓山脊，画面最暗、中央区最干净）
- 深海：1078（俯拍海浪拍岸）

## 授权（Mixkit Stock Video **Free** License）

- 四支素材页的结构化元数据均为：`"copyrightNotice":"Free"`、`"isAccessibleForFree":true`、`"license":"https://mixkit.co/license/#videoFree"`，且**未命中 `Restricted` 档**。
- Mixkit 站点自述原文：`Mixkit is a free resource hub providing high-quality video clips, music tracks, and sound effects for creators, offering carefully curated assets that can be used in commercial and personal projects without attribution.`
- 完整条款：https://mixkit.co/license/#videoFree （条款正文由前端渲染，静态抓取不到，请以浏览器打开为准）。
- **它不是 CC0**：可免费商用、免署名，但**不得把素材本身当作素材库再分发/转售**。本目录是「项目自带资源」，属正常使用；若日后要单独抽出 `vendor/video/` 分发，请重新确认。
- **Restricted 档的两个识别信号（2026-09-22 实证，踩坑 #051）**：
  1. 素材页元数据 `"copyrightNotice":"Mixkit Restricted License"`（免费版仅限个人使用，商业用途需 Envato 订阅）；
  2. 其 `-1080.mp4` 直链被 CDN 拒绝，返回 **111 字节 XML `<Error><Code>AccessDenied</Code>`** —— 与「连接被重置（curl 35/000）」的**限流**是两种失败，别混为一谈：限流要等，AccessDenied 等多久都没用。
- Free 素材页 HTML 也只列 720/360 直链，但 `-1080.mp4` 实际可下（28339 / 4148 实测成功）——**「页面没列 1080」不能作为「没有 1080」的依据**，以带 Referer 实测为准。选素材的正确顺序：**先抓素材页核实 `copyrightNotice`，再下载 1080**。

## 处理链路（可复现）

1080p 原片 7~46 秒不等。两个关键决定：

1. **正向无缝循环，不用波折（boomerang）**：正放+倒放会让雾、火、水出现明显的"倒带感"（v1 被用户指出"不真实"的主因之一）。用 `xfade` 把**结尾与开头交叉溶解**——输出最后 F 秒是"尾部 → 头部"的渐变，循环点两侧画面连续：
   ```bash
   # T=成片长度, F=溶解时长(2~2.5s)；head 取自片段开头
   ffmpeg -y -ss {start} -t {T+0.5} -i {id}-1080.mp4 -filter_complex "\
     [0:v]scale=-2:1080:flags=lanczos,fps=24,hqdn3d={d}:{d}:{2d}:{2d},split[a][b];\
     [a]trim=0:{T},setpts=PTS-STARTPTS[main];\
     [b]trim=0:{F},setpts=PTS-STARTPTS[head];\
     [main][head]xfade=transition=fade:duration={F}:offset=$({T}-{F})[out]" \
     -map "[out]" -an -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
     -crf {24~27} -tune film -preset veryslow -movflags +faststart {scene}.mp4
   ```
   源片太短时（deep 7.4s）只能做 5 秒左右的成片，把溶解段加长到 2.4~2.5s 可以让循环更看不出接缝。
2. **夜空/火焰素材必须时域降噪**：极光原片 ISO 噪点极重，CRF 23 直接编码 5 秒要 10.6MB；`hqdn3d=4:4:8:8` 后降到 4.67MB，画面反而更干净（固定机位的夜空，时域降噪零副作用）。火焰噪点也多，`hqdn3d=2:2:4:4` + CRF 26/27。

**v4 两支的实际参数**：ember（2707，源 11.3s/23.976fps，`-ss 1.5`）→ T=8s、F=2.5s、`hqdn3d=2:2:4:4`、CRF 26 → **3.41MB**；star（4148，源 16.2s/30fps，`-ss 2`）→ T=8s、F=2.5s、`hqdn3d=4:4:8:8`、CRF 24 → **5.71MB**。

其余：`-tune film` 保留胶片颗粒感；`-movflags +faststart` 让边下边播；下载必须带 `Referer: https://mixkit.co/` + 浏览器 UA（防盗链，裸 curl 连接直接失败返回 000）。**该站对同一 IP 有突发限流**——连续下几百 MB 后所有请求都会连接重置（curl 35），等几分钟自动恢复；单支下载之间隔 20 秒、`--limit-rate` 限速更稳。

## 运行时行为

- **不写进 Service Worker 预缓存清单**（`sw.js` 的 `SHELL` / `build.js` 的 shell 数组）：安装包轻一点，首播时由 SW 的 fetch 处理器顺手缓存，之后离线可用。同名文件换内容时，SW 的 stale-while-revalidate 会在后台静默更新缓存——老用户最多再看到一次旧片，随后自动生效，因此**换视频不需要 bump SW 缓存版本**。
- 文件缺失 / 解码失败 / 离线首访：`error` 事件后该场景当次会话不再重试，画面仍是 CSS 场景——**视频永远是叠加层，不是唯一底**。
- 视频播放时 `#focus-stage.has-video` 会：停掉场景自带的 CSS 动态层（省 GPU）、把 `.fs-veil` 降到 68%（别洗掉 1080p 的细节）、亮起 `.fs-halo`（数字区与上下控件区的可读性雾，颜色取各场景 `--fs-halo`，与文字色反极性）。
- **篝火在视频态会翻转整套配色极性**（`#focus-stage.has-video[data-scene="ember"]`）：壁炉暖光 + 暗砖墙的素材配浅色字 + 深色光晕才读得清；晨雾/深海/星野三支保持原极性。**给某个场景换素材后，先截图看明暗极性对不对，再决定要不要加这条翻转**（2026-09-22 换 2707 后截图复核：浅色字 + halo 可读，翻转规则保留）。

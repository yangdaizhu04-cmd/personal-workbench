# vendor/video —— 沉浸专注层的循环视频背景

八支短片只在**沉浸专注层**里播放（`js/16-immersive.js`）：进入沉浸才加载、退出即停并释放；单文件版与 `html.no-motion` 一律不加载，回落 CSS 场景。

全部 **1920×1080 / 24fps / 无音轨 / 正向无缝循环**，合计 **18.16 MB**。
（v1 曾是 720p + 波折循环，因「放大偏软 + 倒带感」重做；v2 篝火/星野因「冲击力不足」更换（踩坑 #050）；v4 用户评价篝火/星野「效果很不好」→ 篝火换室内壁炉、星野换银河山脊（踩坑 #051）；**v5（2026-09-22）场景由 4 套扩到 8 套**，新增室内组四支，标准按用户要求定为「**安静温馨、能平静专注、有电影感**」。）

## 清单与来源

| 场景文件 | 素材 | Mixkit 素材页 | 原片直链 |
|---|---|---|---|
| `mist.mp4`（晨雾·10s·1.36MB） | 28339 · Forest covered by mist at sunrise | /forest-covered-by-mist-at-sunrise-from-the-heights-28339/ | `assets.mixkit.co/videos/28339/28339-1080.mp4` |
| `deep.mp4`（深海·5.4s·2.22MB） | 4291 · School of fish swimming | /school-of-fish-swimming-4291/ | `assets.mixkit.co/videos/4291/4291-1080.mp4` |
| `ember.mp4`（篝火·8s·3.41MB） | 2707 · A fireplace lit at Christmas time | /a-fireplace-lit-at-christmas-time-2707/ | `assets.mixkit.co/videos/2707/2707-1080.mp4` |
| `star.mp4`（星野·8s·5.71MB） | 4148 · Milky way seen at night | /milky-way-seen-at-night-4148/ | `assets.mixkit.co/videos/4148/4148-1080.mp4` |
| `cafe.mp4`（咖啡馆·8s·0.37MB） | 808 · Steaming mug（浅景深热饮静物、蒸汽、bokeh 暖光） | /steaming-mug-808/ | `assets.mixkit.co/videos/808/808-1080.mp4` |
| `study.mp4`（书房·8s·1.46MB） | 21612 · Ancient map of the world in the dark lit by candlelight（烛光+古地图+放大镜） | /ancient-map-of-the-world-in-the-dark-lit-by-21612/ | `assets.mixkit.co/videos/21612/21612-1080.mp4` |
| `rain.mp4`（雨窗·8s·2.68MB） | 99839 · Raindrops on a window with blurred lights in the background | /raindrops-on-a-window-with-blurred-lights-in-the-background-99839/ | `assets.mixkit.co/active_storage/video_items/99839/1717104607/99839-video-1080.mp4` |
| `lamp.mp4`（暖灯·8s·0.96MB） | 3111 · Master bedroom and window（床头暖灯 + 窗外蓝调夜景） | /master-bedroom-and-window-3111/ | `assets.mixkit.co/videos/3111/3111-1080.mp4` |

### v5 室内组的选材标准（用户口径：安静温馨 + 平静专注 + 电影感）

三条硬指标，缺一不可：
1. **无人物**（或人物极其次要）—— 陌生人入画会破坏「一个人的专注空间」；
2. **无强动态**—— 车流、奔跑、快速推拉一律排除（雨窗最初选的 2846 就是被「橙红车灯」否掉的）；
3. **电影感**—— 浅景深 / 焦外光斑 / 单点光源 / 强暗部层次（`cafe` 的 bokeh 暖光、`study` 的烛光地图、`rain` 的焦外灯斑都属此类）。

同时保留老标准：暗部占比高（浅色或深色文字都能读）、构图上没有与中央数字打架的主体。

**已核实不可用的 Restricted 素材**（免费版仅个人使用、1080 直链被 CDN 拒绝）：47818、47311、31352、31466、21855、30253（以上篝火/夜景类）、24632、48574（图书馆类）。Restricted 会同时死在「授权」与「分辨率」两处，选材时**先核对再下载**（见下）。

**备选**（Free 档、已核实）：篝火 51633（后院火盆）/ 51634（林中烟雾火星）/ 100252（倒茶桌面静物）、星野 4124（银河横贯上半部）、深海 1078（俯拍海浪拍岸）、图书馆 21591 / 21594 / 21595、餐馆内景 4385。

## 授权（Mixkit Stock Video **Free** License）

- 八支素材页的结构化元数据均为：`"copyrightNotice":"Free"`、`"isAccessibleForFree":true`、`"license":"https://mixkit.co/license/#videoFree"`，且**未命中 `Restricted` 档**。
- 完整条款：https://mixkit.co/license/#videoFree （正文由前端渲染，静态抓取不到，请以浏览器打开为准）。
- **它不是 CC0**：可免费商用、免署名，但**不得把素材本身当作素材库再分发/转售**。本目录是「项目自带资源」，属正常使用。
- **Restricted 档的两个识别信号（踩坑 #051）**：① 素材页 `"copyrightNotice":"Mixkit Restricted License"`；② 其 1080 直链返回 **111 字节 XML `<Error><Code>AccessDenied</Code>`** —— 与「连接被重置」的**限流**是两种失败：限流要等，AccessDenied 等多久都没用。
- **Free 素材页 HTML 只列 720/360 直链，但 1080 实际可下**（多支实测）——「页面没列」≠「不存在」，以带 Referer 实测为准。
- **⚠️ CDN 有两套直链格式（v5 踩坑 #052）**：
  - 老库：`https://assets.mixkit.co/videos/{id}/{id}-1080.mp4`
  - 新库（ActiveStorage，2024 年后上传的素材）：`https://assets.mixkit.co/active_storage/video_items/{id}/{timestamp}/{id}-video-1080.mp4`
  - 用老格式去拼新素材 → **AccessDenied**（不是限流、也不是授权问题）。**判断办法**：抓素材页 HTML，正则提取 `https?://[^"']*\.mp4`，页面里列的就是真实路径（`inspect` 脚本十行搞定）。

## 处理链路（可复现）

1080p 原片 7~46 秒不等。两个关键决定：

1. **正向无缝循环，不用波折（boomerang）**：正放+倒放会让雾、火、水出现明显的"倒带感"。用 `xfade` 把**结尾与开头交叉溶解**——输出最后 F 秒是"尾部 → 头部"的渐变，循环点两侧画面连续：
   ```bash
   # T=成片长度, F=溶解时长(2~2.5s)；head 取自片段开头
   ffmpeg -y -ss {start} -t {T+0.6} -i {1080原片} -filter_complex "\
     [0:v]scale=-2:1080:flags=lanczos,fps=24,hqdn3d={d}:{d}:{2d}:{2d},split[a][b];\
     [a]trim=0:{T},setpts=PTS-STARTPTS[main];\
     [b]trim=0:{F},setpts=PTS-STARTPTS[head];\
     [main][head]xfade=transition=fade:duration={F}:offset=$({T}-{F})[out]" \
     -map "[out]" -an -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
     -crf {24~27} -tune film -preset veryslow -movflags +faststart {scene}.mp4
   ```
   源片太短时缩短成片：`study` 源仅 10s → T=8、F=2（需 10.5s 素材）；`deep` 源 7.4s → 5.4s 成片。
2. **夜景/火焰素材必须时域降噪**：极光原片 ISO 噪点极重，CRF 23 直接编码 5 秒要 10.6MB；`hqdn3d=4:4:8:8` 后降到 4.67MB 且画面更干净（固定机位夜景零副作用）。火焰 `2:2:4:4`；浅景深静物（cafe/lamp）`1.2:1.2:2:2` 就够。

**v5 四支的实际参数**（源片 → 成片）：`cafe`（808，10.75s，`-ss 0.4`）→ T=8/F=2.5/`hqdn3d=1.2`/CRF 24 → **0.37MB**（静物画面几乎不动，压缩率极高）；`study`（21612，10s，`-ss 0.3`）→ T=8/F=2/`2:2:4:4`/CRF 24 → 1.46MB；`rain`（99839，20s，`-ss 1.1`）→ T=8/F=2.5/`2:2:4:4`/CRF 25 → 2.68MB；`lamp`（3111，15s，`-ss 0.6`）→ T=8/F=2.5/`1.2`/CRF 25 → 0.96MB。

其余：`-tune film` 保留胶片颗粒感；`-movflags +faststart` 边下边播；下载必须带 `Referer: https://mixkit.co/` + 浏览器 UA（防盗链，裸 curl 直接失败返回 000）。**该站对同一 IP 有突发限流**——连续下几百 MB 后所有请求连接重置（curl 35），等几分钟自动恢复；单支之间隔 20~25 秒、`--limit-rate` 限速更稳。

## 运行时行为

- **不写进 Service Worker 预缓存清单**（`sw.js` 的 `SHELL` / `build.js` 的 shell 数组）：安装包轻一点，首播时由 SW 的 fetch 处理器顺手缓存。同名文件换内容时 SW 的 stale-while-revalidate 会在后台静默更新——**换视频不需要 bump SW 缓存版本**。
- 文件缺失 / 解码失败 / 离线首访：该场景当次会话不再重试，画面仍是 CSS 场景——**视频永远是叠加层，不是唯一底**。
- 视频播放时 `#focus-stage.has-video` 会：停掉 CSS 动态层（省 GPU）、`.fs-veil` 降到 68%、亮起 `.fs-halo`（数字区与上下控件区的可读性雾）。
- **极性规则（换素材后必须截图复核，这是最容易翻车的地方）**：

| 场景 | 亮色主题文字 | 视频态处理 |
|---|---|---|
| mist / deep / star / lamp | 浅色字（暗调视频） | 直接用基础配色 |
| ember | 深色字 → **视频态翻转成浅字** | `#focus-stage.has-video[data-scene="ember"]` |
| study / rain | 深色字 → **视频态翻转成浅字**（素材本身是暗调） | 同上（规则不带主题前缀，暗色主题的特异性更高不会被盖掉） |
| **cafe** | **两种主题都保持深色字** | 素材是「亮陶杯 + 暗背景」中调静物，数字正压在亮杯面上；暗色主题若按常规翻浅字会糊进杯子里（实测不可读），故亮/暗各写一条显式规则 |

# vendor/video —— 沉浸专注层的循环视频背景

八支短片只在**沉浸专注层**里播放（`js/16-immersive.js`）：进入沉浸才加载、退出即停并释放；单文件版与 `html.no-motion` 一律不加载，回落 CSS 场景。

全部 **1920×1080 / 24fps / 无音轨 / 正向无缝循环**，合计 **25.02 MB**。
版本沿革：v1 是 720p + 波折循环（被评"不真实且不高清"）→ v2/v3 重选素材与循环方式 → v4 换篝火/星野 → v5 由 4 场景扩到 8 场景（先做了一版**室内组**：咖啡馆/书房/雨窗/暖灯）→ **v6（2026-09-22 当晚）室内组被评价「效果非常差」，整体换成「世界自然风光」**：雪山（阿尔卑斯）/ 湖泊 / 碧海 / 草甸。

## 清单与来源

| 场景文件 | 素材 | Mixkit 素材页 | 原片直链 |
|---|---|---|---|
| `mist.mp4`（晨雾·10s·1.36MB） | 28339 · Forest covered by mist at sunrise | /forest-covered-by-mist-at-sunrise-from-the-heights-28339/ | `assets.mixkit.co/videos/28339/28339-1080.mp4` |
| `deep.mp4`（深海·5.4s·2.22MB） | 4291 · School of fish swimming | /school-of-fish-swimming-4291/ | `assets.mixkit.co/videos/4291/4291-1080.mp4` |
| `ember.mp4`（篝火·8s·3.41MB） | 2707 · A fireplace lit at Christmas time | /a-fireplace-lit-at-christmas-time-2707/ | `assets.mixkit.co/videos/2707/2707-1080.mp4` |
| `star.mp4`（星野·8s·5.71MB） | 4148 · Milky way seen at night | /milky-way-seen-at-night-4148/ | `assets.mixkit.co/videos/4148/4148-1080.mp4` |
| `snow.mp4`（雪山·8s·2.36MB） | 4283 · Swiss Alps snow background time-lapse（云掠过雪峰的延时） | /swiss-alps-snow-background-time-lapse-4283/ | `assets.mixkit.co/videos/4283/4283-1080.mp4` |
| `lake.mp4`（湖泊·8s·0.98MB） | 4998 · Landscape of a large lake during sunset from the air（日落湖湾航拍，山体剪影+暖金天空） | /landscape-of-a-large-lake-during-sunset-from-the-air-4998/ | `assets.mixkit.co/videos/4998/4998-1080.mp4` |
| `sea.mp4`（碧海·8s·2.16MB） | 5008 · Turquoise blue water bay from above（喀斯特山峰+绿松石水面） | /turquoise-blue-water-bay-from-above-5008/ | `assets.mixkit.co/videos/5008/5008-1080.mp4` |
| `meadow.mp4`（草甸·8.5s·6.82MB） | 21577 · Landscape of a large open field on a sunny afternoon（草原+远山+乌云压境） | /landscape-of-a-large-open-field-on-a-sunny-afternoon-21577/ | `assets.mixkit.co/videos/21577/21577-1080.mp4` |

### v6 风光组的选材实录（含素材库现状）

**用户的定稿口径**：世界自然风光美景（点名阿尔卑斯山）＋ 电影感。

**Mixkit 免费库的两个硬约束**（都已实测）：
1. **「fjord（峡湾）」无任何素材**（搜索页 0 结果）——挪威峡湾类画面用「大湖日落航拍」（4998，水面+群山纵深）承接；
2. **「冰川 / 冰岛系列」整批是 Restricted 档**（8025 冰川湖、8035 冰川入海、8015 冰原、8143/8050/8081/8082/48402/26939 全数不可用；海岸系 31683/30445/8017/8049/27228 同）——冰川湖的「冰蓝水面」用「绿松石海湾俯瞰」（5008）承接。尼亚加拉（46384）与伊瓜苏（11060）同为 Restricted。

**已核实不可用的 Restricted 素材总表**（累计）：47818、47311、31352、31466、21855、30253（篝火/夜景）；24632、48574（图书馆）；8025、8035、8015、8143、8050、8081、8082、48402、26939（冰川/冰岛）；31683、30445、8017、8049、27228（冰岛海岸）；15919、16124（河谷航拍）；46384（尼亚加拉）、11060（伊瓜苏）。

**被否的 Free 候选**（画面不合口径，留档避免重复试）：41388（农业耕地、田垄纹重）、40657（竖屏 720×1280）、26080（垂直俯视、画面过密）、4396/4132/51689（云海/航拍雪山备选）。

## 授权（Mixkit Stock Video **Free** License）

- 八支素材页的结构化元数据均为：`"copyrightNotice":"Free"`、`"isAccessibleForFree":true`、`"license":"https://mixkit.co/license/#videoFree"`，且**未命中 `Restricted` 档**。
- 完整条款：https://mixkit.co/license/#videoFree （正文由前端渲染，静态抓取不到，请以浏览器打开为准）。
- **它不是 CC0**：可免费商用、免署名，但**不得把素材本身当作素材库再分发/转售**。本目录是「项目自带资源」，属正常使用。
- **Restricted 档的识别（踩坑 #051）**：① 素材页 `"copyrightNotice":"Mixkit Restricted License"`；② 其 1080 直链返回 **111 字节 XML `AccessDenied`** —— 与「连接被重置」的**限流**是两种失败：限流要等，AccessDenied 等多久都没用。
- **CDN 有两套直链格式（踩坑 #052）**：老库 `assets.mixkit.co/videos/{id}/{id}-1080.mp4`；新库（ActiveStorage）`assets.mixkit.co/active_storage/video_items/{id}/{timestamp}/{id}-video-1080.mp4`。用错格式 → AccessDenied（容易误判成 Restricted）。**判断办法**：抓素材页 HTML 正则 `https?://[^"']*\.mp4`，页面里写的就是真实路径。
- **选材流程（务必按序）**：抓分类页 → 挑候选 → **抓素材页核 `copyrightNotice` + 提取真实直链** → 才下载 1080p。

## 处理链路（可复现）

```bash
# T=成片长度, F=溶解时长；head 取自片段开头
ffmpeg -y -ss {start} -t {T+0.6} -i {1080原片} -filter_complex "\
  [0:v]scale=-2:1080:flags=lanczos,fps=24,hqdn3d={d}:{d}:{2d}:{2d},split[a][b];\
  [a]trim=0:{T},setpts=PTS-STARTPTS[main];\
  [b]trim=0:{F},setpts=PTS-STARTPTS[head];\
  [main][head]xfade=transition=fade:duration={F}:offset=$({T}-{F})[out]" \
  -map "[out]" -an -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
  -crf {24~27} -tune film -preset veryslow -movflags +faststart {scene}.mp4
```

- **正向无缝循环**（不用波折）：`xfade` 把结尾 F 秒与开头 F 秒交叉溶解，循环点两侧画面连续、无倒放感。
- **时域降噪按素材定**：夜景/火焰 `hqdn3d=2:2:4:4`~`4:4:8:8`；明亮风景/浅景深静物 `1.2:1.2:2:2` 即可。
- **运动素材 × 溶解循环的取舍（v6 新坑）**：`meadow` 的近景树叶在风里持续摆动，溶解期必然出现"半透明重影"（按 -ss 换起点无解，因为风一直在吹）。解法是**把溶解加长到 3.5s**——重影摊薄成"风的流动"；实测动态播放比静帧观感自然得多（静帧看四联图会放大这个问题）。选运动素材时优先"主体运动缓慢"的画面（云、水、雾），近景树叶/人物衣物是高风险主体。
- **v6 四支实际参数**：`snow`（4283，14.4s/30fps，`-ss 0.5`）→ T=8/F=2.5/`hqdn3d=1.2`/CRF 24 → 2.36MB；`lake`（4998，20s，`-ss 1`）→ T=8/F=2.5/`2:2:4:4`/CRF 25 → 0.98MB（剪影画压缩率高）；`sea`（5008，15.1s，`-ss 0.8`）→ T=8/F=2.5/`1.2`/CRF 25 → 2.16MB；`meadow`（21577，15s，`-ss 2.5`）→ T=8.5/F=**3.5**/`1.2`/CRF 25 → 6.82MB（细节最密）。

其余：下载必须带 `Referer: https://mixkit.co/` + 浏览器 UA；**该站对同一 IP 有突发限流**（连续几百 MB 后全部连接重置，等几分钟恢复；单支之间隔 20~25 秒、`--limit-rate` 限速更稳）。

## 运行时行为

- **不写进 Service Worker 预缓存清单**：首播时由 SW 的 fetch 处理器顺手缓存；同名换内容时 SW 的 stale-while-revalidate 会后台更新——**换视频不需要 bump SW 缓存版本**。
- 文件缺失 / 解码失败 / 离线首访：该场景当次会话不再重试，画面仍是 CSS 场景——**视频永远是叠加层，不是唯一底**。
- 视频播放时 `#focus-stage.has-video` 会：停掉 CSS 动态层、`.fs-veil` 降到 68%、亮起 `.fs-halo`（数字区与上下控件区的可读性雾）。
- **极性规则（换素材后必须截图复核）**：

| 场景 | 亮色主题文字 | 视频态处理 |
|---|---|---|
| mist / deep / star | 各自原配色 | 不翻转 |
| **snow / sea / meadow** | 深色字（素材亮调或中调，深字直接可读） | 不翻转；halo 取浅色（把数字区提亮托住深字） |
| **lake** | 深色字 → **视频态翻转成浅字**（日落剪影是大面积暗调） | `#focus-stage.has-video[data-scene="lake"]`，不带主题前缀、暗色主题的特异性更高不会盖它 |
- **暗色主题的亮度例外**：全局 `html[data-theme="dark"] .fs-video{filter:brightness(.86)}` 会把**雪山/碧海**这两支明亮素材压成灰调、失掉风景的呼吸感，已给它们单独放宽到 `.97`（可读性由深色 halo 兜底）。
- **`snow` 的特征动画（雪粒）在 `.fs-fx::before`**、冷光漂移在 `::after`——测试脚本约定"特征动画取 `::before` 的 animationName"，加新场景时注意分层。

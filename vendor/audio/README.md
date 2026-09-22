# vendor/audio —— 真实环境录音台账

声音面板七路音源（雨声/海浪/篝火/钢琴/白噪/氛围/Lo-Fi）使用的真实录音，授权分两批：

- **雨声 / 海浪 / 篝火 / 钢琴**（前四路）：**Pixabay Content License**（免费商用、免署名、可修改再分发）。
  2026-09-22 自同作者另一个项目 pixel-town 换入：mp3 原曲经 ffmpeg `loudnorm=I=-21:TP=-2` 统一响度、
  降码转码，再转 Ogg Opus 瘦身（同响度体积约为 mp3 的七成）。
- **白噪 / 氛围 / Lo-Fi**（后三路）：**Creative Commons 0（公有领域贡献）**，来源 OpenGameArt.org，
  经 ffmpeg 处理为无缝循环 OGG（Vorbis q5）：裁剪首尾 1.5s → 45Hz 高通去隆隆声 → 静态增益对齐响度
  （约 -23 LUFS）→ 2.5s 交叉淡化首尾拼接（白噪一路把 7s 素材五份交叉淡化拼成 30s 长底再循环；
  Lo-Fi 裁到 73.5s 控制体积）。

## 文件清单（2026-09-22 现状）

| 文件 | 时长 | 体积 | 素材 | 作者 | 授权 | 来源 |
|---|---|---|---|---|---|---|
| rain.ogg | 1:44 | 0.73MB | Light Rain | Pixabay（未知署名，素材页留档） | Pixabay Content License | https://cdn.pixabay.com/audio/2022/04/16/audio_520eb6a5cc.mp3 |
| waves.ogg | 2:12 | 0.90MB | Soothing Ocean Waves | Pixabay | Pixabay Content License | https://cdn.pixabay.com/audio/2025/07/09/audio_56227295c2.mp3 |
| fire.ogg | 1:01 | 0.50MB | Campfire in the Woods | DRAGON-STUDIO | Pixabay Content License | https://cdn.pixabay.com/audio/2026/01/16/audio_9b2a34b5c3.mp3 |
| piano.ogg | 2:07 | 1.71MB | Piano Calm | leberch | Pixabay Content License | https://cdn.pixabay.com/audio/2026/05/08/audio_f386318628.mp3 |
| white.ogg | 30s | 0.37MB | noise_01.ogg（30 CC0 SFX loops 包） | rubberduck | CC0 | https://opengameart.org/content/30-cc0-sfx-loops |
| pad.ogg | 21.5s | 0.39MB | Ambient Relaxing Loop | isaiah658 | CC0 | https://opengameart.org/content/ambient-relaxing-loop |
| lofi.ogg | 73.5s | 1.37MB | Chill lofi inspired | josepharaoh99 | CC0 | https://opengameart.org/content/chill-lofi-inspired |

- Pixabay 授权凭证：https://pixabay.com/service/license-summary/ ；CC0 凭证见各素材页
  （CC0 1.0 deed：https://creativecommons.org/publicdomain/zero/1.0/）。
- 七路均优先加载真实录音；任一文件缺失/加载失败时自动回退到 WebAudio 实时合成并在面板标注"（合成）"。
- 替换历史：前三代雨声/篝火为 freesound 素材（Heavy Rain from Front Porch / campfire.wav）、
  钢琴为 OpenGameArt「Emotional Piano Loop」（标签曾是"雨夜钢琴"），2026-09-22 全部换入
  pixel-town 的 Pixabay 录音（海浪为新增一路，白噪一路的取舍记录见 开发踩坑.md #018）。

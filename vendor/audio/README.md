# vendor/audio —— CC0 真实环境录音

声音面板六路音源（雨声/篝火/白噪/钢琴/氛围/Lo-Fi）使用的真实录音，**授权均为 Creative Commons 0（公有领域贡献）**，
可自由使用、修改、再分发，无需署名。来源为 freesound.org / OpenGameArt.org 的公开素材，
经 ffmpeg 处理为无缝循环 OGG（Vorbis q5）：裁剪首尾 1.5s → 45Hz 高通去隆隆声 →
静态增益对齐响度（约 -23 LUFS）→ 2.5s 交叉淡化首尾拼接（白噪一路先把 7s 素材五份交叉淡化拼成 30s 长底再循环；
Lo-Fi 裁到 73.5s 控制体积）。

| 文件 | 时长 | 体积 | 素材 | 作者 | 来源 |
|---|---|---|---|---|---|
| rain.ogg | 87s | 1.5MB | Heavy Rain from Front Porch | timothyd4y | https://freesound.org/people/timothyd4y/sounds/527500/ |
| fire.ogg | 192.5s | 3.8MB | campfire.wav | Spandau | https://freesound.org/people/Spandau/sounds/40699/ |
| white.ogg | 30s | 0.37MB | noise_01.ogg（30 CC0 SFX loops 包） | rubberduck | https://opengameart.org/content/30-cc0-sfx-loops |
| piano.ogg | 24.8s | 0.41MB | Emotional Piano Loop | extenz | https://opengameart.org/content/emotional-piano-loop |
| pad.ogg | 21.5s | 0.39MB | Ambient Relaxing Loop | isaiah658 | https://opengameart.org/content/ambient-relaxing-loop |
| lofi.ogg | 73.5s | 1.37MB | Chill lofi inspired | josepharaoh99 | https://opengameart.org/content/chill-lofi-inspired |

授权凭证见各素材页（CC0 1.0 deed：https://creativecommons.org/publicdomain/zero/1.0/）。

注：六路均优先加载真实录音；任一文件缺失/加载失败时自动回退到 WebAudio 实时合成并在面板标注"（合成）"。
白噪一路曾有"合成与录音听感无差异、录音反而引入压缩失真"的取舍记录，2026-09-13 按用户要求统一替换为真实录音
（风扇噪声循环拼长底），合成器保留作回退。处理参数见 开发踩坑.md #018。

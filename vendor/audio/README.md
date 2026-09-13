# vendor/audio —— CC0 真实环境录音

声音面板「雨声 / 篝火」两路使用的真实录音，**授权均为 Creative Commons 0（公有领域贡献）**，
可自由使用、修改、再分发，无需署名。来源为 freesound.org 的公开试听转码（hq MP3），
经 ffmpeg 处理为无缝循环 OGG（Vorbis q5）：裁剪首尾 1.5s → 45Hz 高通去隆隆声 →
静态增益对齐响度（约 -23 LUFS）→ 2.5s 交叉淡化首尾拼接。

| 文件 | 时长 | 体积 | 素材 | 作者 | 来源 |
|---|---|---|---|---|---|
| rain.ogg | 87s | 1.5MB | Heavy Rain from Front Porch | timothyd4y | https://freesound.org/people/timothyd4y/sounds/527500/ |
| fire.ogg | 192.5s | 3.8MB | campfire.wav | Spandau | https://freesound.org/people/Spandau/sounds/40699/ |

授权凭证见各素材页右上角「Creative Commons 0」
（CC0 1.0 deed：https://creativecommons.org/publicdomain/zero/1.0/）。

注：白噪一路仍为 WebAudio 实时合成——白噪本身即为随机信号，合成与录音在听感上无差异，
录音反而引入压缩失真，故不更换。处理脚本参数记录于 开发踩坑.md。

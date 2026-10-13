/* slim-videos.mjs —— 沉浸场景视频瘦身（**可选工具**，不参与构建、不影响任何形态的产物）

   背景（2026-10-14 换景卡顿整改的 C 档）：
   vendor/video/*.mp4 共 12 支、38.68MB，全部 1920×1080 / 24fps / 无音轨，且都已是
   faststart（moov 前置，起播无需等整段下载）。其中三支占了总量的一半以上：
     glade 7.23MB · meadow 6.82MB · star 5.71MB
   Web/云版的每支视频「第一次切换」都要走一次网络（Service Worker 只在访问过后才缓存），
   所以体积直接等于首切的空窗时长。降到 720p 能把总量砍掉约六成，而沉浸层里视频上面
   盖着雾面 + 光晕 + 巨型数字，画质损失需要用真机对比确认（不要只看桌面截屏下结论）。

   用法：
     node tools/slim-videos.mjs                  # 全部转码到 vendor/video-slim/（只对比，不动原片）
     node tools/slim-videos.mjs star glade       # 只处理指定的几支（不带 .mp4 后缀）
     node tools/slim-videos.mjs --in-place       # 转完直接替换 vendor/video/（原片自动备份到系统 TEMP）
     node tools/slim-videos.mjs --out=D:/tmp/x   # 换个输出目录（默认为 vendor/video-slim/）

   注意：
   · 产物目录 vendor/video-slim/ 在 .gitignore 内 —— 它只是「对比样张」，确认画质之后
     才用 --in-place 落到原片位置并提交；
   · --in-place 会把原片复制到系统 TEMP 的 wb-video-backup/ 下，随时可回滚；
   · 依赖 ffmpeg（PATH 里能找到即可）。开发机上实测可用版本：ffmpeg 8.1.1。
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "vendor/video");

const CRF = 30;          // 质量/体积的平衡点：30 在 720p 风景素材上看不出明显损失
const HEIGHT = 720;      // 1080p → 720p，像素量降到 44%

const args = process.argv.slice(2);
const inPlace = args.includes("--in-place");
const outArg = args.find(a => a.startsWith("--out="));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(ROOT, "vendor/video-slim");
const picks = args.filter(a => !a.startsWith("--"));

function hasFfmpeg(){
  try{ execFileSync("ffmpeg", ["-version"], {stdio: "ignore"}); return true; }
  catch(e){ return false; }
}
if(!hasFfmpeg()){
  console.error("✗ 未找到 ffmpeg。装一个再用（Windows: winget install Gyan.FFmpeg），或把它的 bin 加进 PATH");
  process.exit(2);
}

if(!fs.existsSync(SRC)){ console.error("✗ 找不到 " + SRC); process.exit(2); }
let files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith(".mp4")).sort();
if(picks.length){
  files = files.filter(f => picks.includes(path.basename(f, ".mp4")));
  const miss = picks.filter(p => !fs.existsSync(path.join(SRC, p + ".mp4")));
  if(miss.length) console.warn("! 跳过不存在的场景：" + miss.join(", "));
}
if(!files.length){ console.error("✗ 没有匹配的视频"); process.exit(2); }

const mb = p => fs.statSync(p).size / 1048576;
const backup = path.join(os.tmpdir(), "wb-video-backup");
fs.mkdirSync(OUT, {recursive: true});
if(inPlace) fs.mkdirSync(backup, {recursive: true});

let before = 0, after = 0;
for(const f of files){
  const src = path.join(SRC, f);
  const dst = path.join(OUT, f);          // 一律先落到 OUT，再决定要不要搬回原片位置
  const b = mb(src);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", src,
    "-an",                                 // 素材本来就无音轨，显式声明免得外部素材带进来
    "-vf", "scale=-2:" + HEIGHT,           // -2 保证宽为偶数（H.264 要求）
    "-c:v", "libx264", "-preset", "slow", "-crf", String(CRF),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",             // 保持 moov 前置（原片全部是 faststart，不能转丢）
    dst,
  ], {stdio: "inherit"});
  const a = mb(dst);
  before += b; after += a;
  if(inPlace){
    fs.copyFileSync(src, path.join(backup, f));   // 原片先备份，可回滚
    fs.copyFileSync(dst, src);
    fs.rmSync(dst);
    console.log("  " + f.padEnd(11) + b.toFixed(2) + "MB → " + a.toFixed(2) + "MB  （已替换，原片备份在 " + backup + "）");
  }else{
    console.log("  " + f.padEnd(11) + b.toFixed(2) + "MB → " + a.toFixed(2) + "MB");
  }
}
console.log("合计 " + before.toFixed(2) + "MB → " + after.toFixed(2) + "MB（-" +
  (100 - after / before * 100).toFixed(0) + "%）");
if(!inPlace) console.log("产物在 " + OUT + "（不入库）。真机对比确认画质后再跑 --in-place 落盘。");

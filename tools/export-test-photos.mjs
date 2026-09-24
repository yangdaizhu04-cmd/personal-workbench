/* export-test-photos.mjs —— 一条命令批量导出三张测试图（不点按钮）
   复用 tools/gen-test-photos.html 里的绘制代码（单一来源，不重复实现），无头 Chrome 渲染后直接写文件。
   用法：
     node tools/export-test-photos.mjs                       → tools/test-photos/ 三张 JPG
     node tools/export-test-photos.mjs --out D:\pics         → 指定输出目录
     node tools/export-test-photos.mjs --b 1.08 --c 1.05 --s .9   → 与页面滑杆同义的微调
   依赖：puppeteer-core（已在 devDependencies）+ 本机 Chrome */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "tools/gen-test-photos.html");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

function arg(name, def){
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const outDir = path.resolve(arg("out", path.join(ROOT, "tools/test-photos")));
const tweak = {b: +arg("b", 1), c: +arg("c", 1), s: +arg("s", 1)};

if(!fs.existsSync(PAGE)){ console.error("✗ 缺少 tools/gen-test-photos.html"); process.exit(2); }
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if(!chromePath){ console.error("✗ 未找到 Chrome，设 CHROME_PATH 环境变量后重试"); process.exit(2); }

fs.mkdirSync(outDir, {recursive: true});
const browser = await puppeteer.launch({executablePath: chromePath, headless: "new", args: ["--no-first-run"]});
const page = await browser.newPage();

const errors = [];
page.on("console", m => { if(m.type() === "error") errors.push("[console] " + m.text()); });
page.on("pageerror", e => errors.push("[pageerror] " + e.message));

await page.goto("file:///" + encodeURI(PAGE.replace(/\\/g, "/")), {waitUntil: "load", timeout: 30000});
await page.waitForFunction("window.__ready === true", {timeout: 20000});

/* 与页面滑杆同一条路径：改 input 值 → 触发 input 事件 → 页面自己重绘 */
await page.evaluate(t => {
  for(const k of ["b", "c", "s"]){
    const el = document.getElementById(k);
    el.value = String(t[k]);
    el.dispatchEvent(new Event("input"));
  }
}, tweak);

const stats = await page.evaluate(() => window.__stats);
const ids = ["highlight", "night", "muted"];
const written = [];
for(const id of ids){
  /* 按 canvas 的固定 id 取图（生成器里 cv-<id>）：DOM 顺序变了会拿到 null 当场报错，
     不会把别的图静默写成 test-night.jpg */
  const dataUrl = await page.evaluate(cid => {
    const cv = document.getElementById("cv-" + cid);
    return cv ? cv.toDataURL("image/jpeg", .9) : null;
  }, id);
  if(!dataUrl){ console.error("✗ 生成器页里找不到 #cv-" + id + "（页面结构被改过？）"); process.exit(1); }
  const file = path.join(outDir, "test-" + id + ".jpg");
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  const a = stats[id];
  written.push("  " + path.basename(file).padEnd(22) +
    Math.round(fs.statSync(file).size / 1024) + " KB" +
    " · 亮度 " + a.lum.toFixed(3) +
    " · 饱和度 " + a.sat.toFixed(3) +
    " · 候选 " + (a.pass * 100).toFixed(1) + "%" +
    " · " + (a.base === "dark" ? "深色基底" : "浅色基底"));
}
await browser.close();

console.log("输出目录：" + outDir);
written.forEach(w => console.log(w));
if(errors.length){ errors.forEach(e => console.error(e)); process.exit(1); }
console.log("✓ 三张测试图已生成（参数 b=" + tweak.b + " c=" + tweak.c + " s=" + tweak.s + "）");

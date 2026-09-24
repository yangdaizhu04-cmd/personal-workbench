/* test-smoke.mjs —— 一键回归冒烟：无头 Chrome 遍历全部路由，收集 console 错误，双主题截图
   用法：node tools/test-smoke.mjs            → 文件夹版 + 单文件版全测
        node tools/test-smoke.mjs --fast     → 只测文件夹版亮色主题
   产物：.tmp/smoke/<target>/<theme>-<route>.png；有错误时退出码 1 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import themeBase from "./theme-base.js";   // CommonJS 助手：首帧档位表的唯一生成处

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".tmp/smoke");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if(!chromePath){ console.error("✗ 未找到 Chrome，设 CHROME_PATH 环境变量后重试"); process.exit(2); }

/* 首帧档位表一致性守卫（生成逻辑见 tools/theme-base.js）：
   index.html 里那份是构建期从 THEMES 表注入的，改了主题表却没跑构建 → 该主题每次启动闪一下米白。
   这类"只闪一下、功能正常"的漏改最难自查（踩坑 #072），所以在回归入口就拦下来 */
{
  const bootSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = /var BASE = \/\*__WB_THEME_BASE__\*\/\{([^}]*)\}/.exec(bootSrc);
  const want = themeBase.readThemeBase().map;
  const got = m ? JSON.parse("{" + m[1] + "}") : null;
  const norm = o => JSON.stringify(Object.keys(o || {}).sort().map(k => k + "=" + o[k]));
  if(norm(got) !== norm(want)){
    console.error("✗ index.html 的首帧档位表与 js/07-theme.js 的 THEMES 表不一致：");
    console.error("    index.html: " + norm(got));
    console.error("    THEMES    : " + norm(want));
    console.error("  → 跑一次 node build.js（构建期会自动注入并同步回 index.html）");
    process.exit(1);
  }
  console.log("✓ 首帧档位表与 THEMES 表一致（" + Object.keys(want).length + " 套主题）");
}

const fast = process.argv.includes("--fast");
const targets = [
  {name: "folder", url: "file:///" + encodeURI(ROOT.replace(/\\/g, "/")) + "/index.html"},
  ...(fast ? [] : [{name: "single", url: "file:///" + encodeURI(ROOT.replace(/\\/g, "/")) + "/" + encodeURI("个人工作台.html")}]),
];
/* 九套主题都要过：只测亮暗会让新主题长期无人看守（2026-09-24 从三套扩到九套） */
const THEMES = fast ? ["light"] : ["light", "dark", "rose", "spring", "sea", "maple", "snow", "ink", "hc"];

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-features=Translate"],
});
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

let failed = 0;
const report = [];

for(const target of targets){
  for(const theme of THEMES){
    const page = await browser.newPage();
    const errors = [];
    page.on("console", msg => {
      if(msg.type() !== "error") return;
      const text = msg.text();
      // 联网层设计为离线优雅降级：断网/第三方接口拒绝时的资源加载失败不算脚本错误。
      // 2026-09-22 补 CORS 一类：60s.viki.moe 限流(429)时不回 Access-Control-Allow-Origin，
      // 浏览器会打 CORS policy 报错——同样属于外部服务状态，应用侧卡片会自动隐藏
      if(/Failed to load resource|net::ERR_|CORS policy/.test(text)) return;
      errors.push("[console] " + text);
    });
    page.on("pageerror", err => errors.push("[pageerror] " + err.message));
    await page.goto(target.url + "#/today", {waitUntil: "load", timeout: 30000});
    await new Promise(r => setTimeout(r, 1800));
    // 首次访问可能有欢迎雾层/启动 toast，等它们退场再切主题
    await page.evaluate(t => { WB.theme.set("theme", t); }, theme);
    await new Promise(r => setTimeout(r, 1200));

    const routes = await page.evaluate(() => Object.keys(WB.router.allRoutes()));
    const dir = path.join(OUT, target.name);
    fs.mkdirSync(dir, {recursive: true});

    for(const route of routes){
      errors.length = 0;
      await page.evaluate(id => { WB.router.go(id); }, route);
      await new Promise(r => setTimeout(r, 950));
      const shot = path.join(dir, theme + "-" + route + ".png");
      await page.screenshot({path: shot});
      // 控制台错误跨路由累积，取本路由窗口内的（简化：去重累计）
      if(errors.length){
        failed++;
        report.push({target: target.name, theme, route, errors: [...new Set(errors)]});
      }
    }
    await page.close();
    console.log((errors.length ? "⚠" : "✓") + " " + target.name + "/" + theme + " · " + routes.length + " 路由已截图");
  }
}
await browser.close();

if(report.length){
  console.error("\n✗ 冒烟发现错误：");
  for(const r of report) console.error("  " + r.target + "/" + r.theme + " #" + r.route + "\n    " + r.errors.slice(0, 3).join("\n    "));
  process.exit(1);
}
console.log("\n✅ 冒烟全过：无 console/page 错误。截图在 .tmp/smoke/");

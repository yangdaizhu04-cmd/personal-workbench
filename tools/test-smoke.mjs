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
/* 九套主题都要过：只测亮暗会让新主题长期无人看守（2026-09-24 从三套扩到九套）。
   照片主题（批次 2）单列一路：没有它，apply 的行内 token / 照片壁纸 / 清理逻辑无人看守 */
const THEMES = fast ? ["light"] : ["light", "dark", "rose", "spring", "sea", "maple", "snow", "ink", "hc"];
const CUSTOM_PHOTO = path.join(ROOT, "tools/test-photos/test-night.jpg");
/* fast 模式跳过；素材缺失（没生成过测试图）时跳过并说明，不算失败 */
const SPECS = THEMES.map(id => ({id}))
  .concat(!fast && fs.existsSync(CUSTOM_PHOTO) ? [{id: "custom-photo", photo: CUSTOM_PHOTO}] : []);
if(!fast && !fs.existsSync(CUSTOM_PHOTO)){
  console.log("· 跳过照片主题一路（缺 " + path.relative(ROOT, CUSTOM_PHOTO) + "，可跑 node tools/export-test-photos.mjs 生成）");
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-features=Translate"],
});
/* 清旧截图：文件名是稳定的（主题-路由），覆盖即可；某些受限环境会拦截上千个文件的批量删除，
   那种情况不该让整轮回归挂掉 —— 记一声继续跑 */
try{ fs.rmSync(OUT, {recursive: true, force: true}); }
catch(e){ console.warn("· 旧截图没清掉（批量删除被拦），本次直接覆盖：", String(e.message).split("\n")[0]); }
fs.mkdirSync(OUT, {recursive: true});

let failed = 0;
const report = [];

for(const target of targets){
  for(const spec of SPECS){
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
    const theme = spec.id;
    let setupFail = "";   // 路由循环每轮会清 errors，建档类错误得单独留着
    if(spec.photo){
      /* 照片主题：先在页面里建档（照片以 base64 注入 —— file:// 下 fetch 读不了本地文件），
         建档失败要显式记错，否则这一路会"静默变成内置主题"地假通过 */
      const b64 = fs.readFileSync(spec.photo).toString("base64");
      const rec = await page.evaluate(async b64 => {
        const bin = atob(b64), arr = new Uint8Array(bin.length);
        for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], "smoke.jpg", {type: "image/jpeg"});
        const src = await WB.customTheme.source(file);
        return await WB.customTheme.create({name: "冒烟照片", base: src.base, accent: src.accent, photo: src.photo, thumb: src.thumb});
      }, b64).catch(e => { console.error("[setup] 照片主题建档异常", e.message); return null; });
      if(!rec) setupFail = "[setup] 照片主题建档失败（IDB 不可用？）";
      else await page.evaluate(id => { WB.theme.set("theme", "custom:" + id); }, rec.id);
    }else{
      await page.evaluate(t => { WB.theme.set("theme", t); }, theme);
    }
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
    if(setupFail){ failed++; report.push({target: target.name, theme, route: "-", errors: [setupFail]}); }
    console.log((errors.length || setupFail ? "⚠" : "✓") + " " + target.name + "/" + theme + " · " + routes.length + " 路由已截图");
  }
}
await browser.close();

if(report.length){
  console.error("\n✗ 冒烟发现错误：");
  for(const r of report) console.error("  " + r.target + "/" + r.theme + " #" + r.route + "\n    " + r.errors.slice(0, 3).join("\n    "));
  process.exit(1);
}
console.log("\n✅ 冒烟全过：无 console/page 错误。截图在 .tmp/smoke/");

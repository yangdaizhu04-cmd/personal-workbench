/* tools/build-extension.mjs —— 打包浏览器新标签页扩展（Chrome/Edge MV3）
   用法：node tools/build-extension.mjs
   产出：extension/dist/ → Chrome 扩展页开启「开发者模式」→「加载已解压的扩展程序」选这个目录
   说明：MV3 的 CSP 禁止内联 <script>，构建时把 index.html 里的首帧主题脚本抽成 boot.js；
        业务代码零改动，数据仍存浏览器本地（localStorage 按扩展 origin 隔离） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "extension", "dist");

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

/* 1. index.html：抽出内联 boot 脚本 */
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if(!m){ console.error("✗ 未找到内联 boot 脚本"); process.exit(1); }
fs.writeFileSync(path.join(OUT, "boot.js"), m[1]);
html = html.replace(m[0], '<script src="boot.js"></script>');
fs.writeFileSync(path.join(OUT, "index.html"), html);

/* 2. 静态资源（sw.js / manifest.webmanifest 不进扩展：SW 在扩展页不可用） */
for(const dir of ["css", "js", "vendor"]){
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), {recursive: true});
}

/* 3. manifest（MV3；无需任何权限，联网 API 走各自的 CORS） */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const manifest = {
  manifest_version: 3,
  name: "个人工作台 · 晨雾奶油",
  short_name: "个人工作台",
  version: (pkg.version || "1.0.0"),
  description: "每天打开新标签页就是你的工作台：三大件、待办、番茄钟与晨雾奶油风总览。数据全部存在浏览器本地。",
  chrome_url_overrides: {newtab: "index.html"},
  minimum_chrome_version: "116",
  permissions: [],
  host_permissions: [],
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

const size = (dir => { let s = 0; for(const f of (function* walk(d){ for(const e of fs.readdirSync(d, {withFileTypes: true})){ const p = path.join(d, e.name); if(e.isDirectory()) yield* walk(p); else yield p; } })(dir)) s += fs.statSync(f).size; return s; })(OUT);
console.log("✅ 扩展已生成 → extension/dist/（" + Math.round(size / 1024) + " KB）");
console.log("   Chrome: chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extension/dist");
console.log("   新标签页即工作台；数据与普通网页互相隔离（扩展有自己的 localStorage）");

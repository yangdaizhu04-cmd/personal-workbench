/* build.js —— 单文件构建：把 CSS/JS/字体全部内联进一个 HTML（双击即开，云端部署用）
   用法：node build.js          → 输出 个人工作台.html
        node build.js --cloud  → 另存 cloud/hosting/{index.html, manifest.webmanifest, sw.js} */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname);

/* 项目根目录边界校验（拒绝越出 ROOT 的路径） */
function safePath(p){
  const target = path.resolve(ROOT, p);
  if(target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new Error("路径越界: " + p);
  return target;
}
function read(p){ return fs.readFileSync(safePath(p), "utf8"); }
function inlineCSS(css){
  // 字体 → base64
  css = css.replace(/url\(["']?([^"')]+\.woff2)["']?\)/g, (m, p1) => {
    const fp = safePath(p1);
    if(!fs.existsSync(fp)){ console.warn("  ! 字体缺失:", p1); return m; }
    const b64 = fs.readFileSync(fp).toString("base64");
    return 'url(data:font/woff2;base64,' + b64 + ')';
  });
  return "<style>\n" + css + "\n</style>";
}

let html = read("index.html");

/* 1. 内联 <link rel="stylesheet"> */
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => inlineCSS(read(href)));

/* 2. 内联 <script src>（保持顺序；转义字符串里的 </script>） */
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = read(src);
  const safe = code.replace(/<\/script>/g, "<\\/script>");
  return "<script>\n" + safe + "\n</script>";
});

/* 3. 校验：HTML 部分（剔除 script 内容）不应再有本地相对引用 */
if(!process.argv.includes("--cloud")){
  // 本地单文件版用不到 PWA manifest，去掉引用避免 404
  html = html.replace(/<link rel="manifest"[^>]*>\n?/g, "");
}
const htmlOnly = html.replace(/<script>[\s\S]*?<\/script>/g, "");
const leftovers = Array.from(htmlOnly.matchAll(/(src|href)="(?!data:|https?:|#|manifest\.webmanifest)([^"]+)"/g)).map(m => m[0]);
if(leftovers.length){
  console.warn("⚠ 仍有未内联的本地引用：");
  leftovers.slice(0, 10).forEach(s => console.warn("  ", s));
}

/* 4. 输出 */
const outFile = safePath("个人工作台.html");
fs.writeFileSync(outFile, html);
console.log("✅ 生成 %s（%s KB）", path.basename(outFile), Math.round(html.length / 1024));

if(process.argv.includes("--cloud")){
  const dir = safePath("cloud/hosting");
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, "index.html"), html);
  fs.copyFileSync(safePath("manifest.webmanifest"), path.join(dir, "manifest.webmanifest"));
  fs.copyFileSync(safePath("sw.js"), path.join(dir, "sw.js"));
  console.log("✅ 云端产物已写入 cloud/hosting/（index.html + manifest + sw.js）");
}

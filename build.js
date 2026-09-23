/* build.js —— 单文件构建：把 CSS/JS/字体全部内联进一个 HTML（双击即开，云端部署用）
   用法：node build.js          → 输出 个人工作台.html
        node build.js --cloud  → 另存 cloud/hosting/{index.html, manifest.webmanifest, sw.js}
   ThreeUI islands：先跑 tools/build-islands.mjs（ThreeUI 仓库存在时），产物 vendor/threeui/islands/*.js
   已提交仓库；单文件版剥离 islands（动态壁纸/窗景/书架为文件夹版专属），注入 WB_SINGLE_FILE 标记。 */
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

/* esbuild 压缩（可选依赖：node_modules/esbuild 不存在时原样返回） */
let esbuild = null;
try{ esbuild = require("esbuild"); }catch(e){}
function minifyJS(code){
  if(!esbuild) return code;
  try{
    return esbuild.transformSync(code, {minify: true, legalComments: "none"}).code;
  }catch(e){ console.warn("  ! JS 压缩失败，使用原样代码:", String(e.message).slice(0, 120)); return code; }
}
function minifyCSS(code){
  if(!esbuild) return code;
  try{
    return esbuild.transformSync(code, {loader: "css", minify: true}).code;
  }catch(e){ console.warn("  ! CSS 压缩失败，使用原样代码:", String(e.message).slice(0, 80)); return code; }
}

function inlineCSS(css){
  // 字体 → base64
  css = css.replace(/url\(["']?([^"')]+\.woff2)["']?\)/g, (m, p1) => {
    const fp = safePath(p1);
    if(!fs.existsSync(fp)){ console.warn("  ! 字体缺失:", p1); return m; }
    const b64 = fs.readFileSync(fp).toString("base64");
    return 'url(data:font/woff2;base64,' + b64 + ')';
  });
  return "<style>\n" + minifyCSS(css) + "\n</style>";
}

let html = read("index.html");

/* 0. 若本地有 ThreeUI 仓库则先重建 islands（否则用已提交产物） */
try{
  require("child_process").execSync("node tools/build-islands.mjs", {cwd: ROOT, stdio: "inherit"});
}catch(e){ /* 仓库缺失：用已提交产物，不阻塞构建 */ }

/* 0.5 单文件版：剥离 islands（含 5.5MB 场景页/1.7MB 书架均不内联），注入标记 */
html = html.replace(
  /<script src="vendor\/threeui\/islands\/[^"]+"><\/script>\n?/g,
  "<script>window.WB_SINGLE_FILE=1;</script>\n"
);

/* 1. 内联 <link rel="stylesheet"> */
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => inlineCSS(read(href)));

/* 2. 内联 <script src>（保持顺序；转义字符串里的 </script>） */
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = read(src);
  const safe = minifyJS(code).replace(/<\/script>/g, "<\\/script>");
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
  fs.writeFileSync(path.join(dir, "manifest.webmanifest"), read("manifest.webmanifest"));
  // SW 预缓存清单自动生成：静态 shell + islands 核心包；场景页/书架走运行时缓存（首次打开后离线可用）
  const shell = ["./", "./index.html", "./manifest.webmanifest",
    "./css/main.css", "./vendor/font/lxgw-wenkai-subset.woff2",
    "./vendor/audio/rain.ogg", "./vendor/audio/waves.ogg", "./vendor/audio/fire.ogg",
    "./vendor/audio/white.ogg", "./vendor/audio/piano.ogg",
    "./vendor/audio/pad.ogg", "./vendor/audio/lofi.ogg",
    "./vendor/threeui/islands/core.js"];
  const sw = read("sw.js").replace(
    /const SHELL = \[[\s\S]*?\];/,
    "const SHELL = [\n" + shell.map(s => '  "' + s + '",').join("\n") + "\n];"
  );
  fs.writeFileSync(path.join(dir, "sw.js"), sw);
  /* 音源文件：sound.js 按相对路径 vendor/audio/*.ogg 取数，SW 预缓存清单也引用它们——hosting 里必须真有 */
  fs.cpSync("vendor/audio", path.join(dir, "vendor", "audio"), {recursive: true});
  console.log("✅ 云端产物已写入 cloud/hosting/（index.html + manifest + sw.js + 音源，预缓存 %d 项）", shell.length);
}

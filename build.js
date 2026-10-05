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

/* 0. 首帧档位表：从 js/07-theme.js 的 THEMES 表注入（唯一来源），并把结果同步回根 index.html ——
   文件夹版、Tauri 版、扩展版都直接吃根 index.html，不同步就等于只有单文件版是对的 */
const {injectThemeBase} = require("./tools/theme-base.js");
html = injectThemeBase(html);
{
  const src = read("index.html");
  const synced = injectThemeBase(src);
  if(synced !== src){
    fs.writeFileSync(safePath("index.html"), synced);
    console.log("🔁 首帧档位表已随 THEMES 表更新（已写回 index.html）");
  }
}

/* 0. 若本地有 ThreeUI 仓库则先重建 islands（否则用已提交产物） */
try{
  require("child_process").execSync("node tools/build-islands.mjs", {cwd: ROOT, stdio: "inherit"});
}catch(e){ /* 仓库缺失：用已提交产物，不阻塞构建 */ }

/* 0.5 单文件版：剥离 islands（含 5.5MB 场景页/1.7MB 书架均不内联），注入标记
   [^>]* 兼容 src 标签上的 async/defer 属性（收紧为 [^"'>]*，避免跨行贪婪误吞） */
html = html.replace(
  /<script src="vendor\/threeui\/islands\/[^"]+"[^"'>]*><\/script>\n?/g,
  "<script>window.WB_SINGLE_FILE=1;</script>\n"
);

/* 1. 内联 <link rel="stylesheet"> */
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => inlineCSS(read(href)));

/* 2. 内联 <script src>（保持顺序；转义字符串里的 </script>；丢弃 async/defer 属性——
   内联后本就同步执行，属性无意义且会让单文件版与文件夹版时序不一致。
   属性区用 [^"'>]* 限定，避免跨行贪婪误吞（L1）） */
html = html.replace(/<script src="([^"]+)"[^"'>]*><\/script>/g, (m, src) => {
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
  /* SW 预缓存清单：**只列 cloud/hosting 里真实存在的文件**。
     这是踩过坑才定下来的形状：`--cloud` 产物是单文件（css/js/字体全部内联），islands 也被剥离，
     所以 `./css/main.css`、`./vendor/font/…woff2`、`./vendor/threeui/islands/core.js`
     在 hosting 里**都不存在**。而 `cache.addAll()` 只要有一项 404 就整体 reject →
     install 失败 → SW 永不激活；注册那行又被 try/catch 吞掉，于是"离线打不开"且毫无报错（踩坑 #098）。
     hosting 里真正需要预缓存的只有：入口两个（./ 与 index.html）、manifest、以及 7 个音源
     （sound.js 按相对路径 vendor/audio/*.ogg 取数，没有它们离线时环境音全哑）。
     要加项时先确认 `fs.cpSync` 之后文件真的在那儿 —— 清单与产物不同步是这类 bug 的唯一来源。 */
  const shell = ["./", "./index.html", "./manifest.webmanifest",
    "./vendor/audio/rain.ogg", "./vendor/audio/waves.ogg", "./vendor/audio/fire.ogg",
    "./vendor/audio/white.ogg", "./vendor/audio/piano.ogg",
    "./vendor/audio/pad.ogg", "./vendor/audio/lofi.ogg",
  ];
  /* 自检：清单里每一项都必须在产物目录里真的存在（构建期就报错，别留给用户发现） */
  const missing = shell.filter(rel => !fs.existsSync(path.join(dir, rel.replace(/^\.\//, ""))));
  if(missing.length){
    console.error("✗ SW 预缓存清单里有产物中不存在的文件：", missing.join("、"));
    process.exitCode = 1;
  }
  const sw = read("sw.js").replace(
    /const SHELL = \[[\s\S]*?\];/,
    "const SHELL = [\n" + shell.map(s => '  "' + s + '",').join("\n") + "\n];"
  );
  fs.writeFileSync(path.join(dir, "sw.js"), sw);
  /* 音源文件：sound.js 按相对路径 vendor/audio/*.ogg 取数，SW 预缓存清单也引用它们——hosting 里必须真有。
     用过滤版拷贝：vendor/audio 下混着工具自己的状态目录（.mimosa），拷进发布产物等于
     把带会话 id 的文件发布出去并入库（.gitignore 忽略了 .mimosa/，但 hosting 是已跟踪目录）。 */
  const AUDIO = ["rain.ogg", "waves.ogg", "fire.ogg", "white.ogg", "piano.ogg", "pad.ogg", "lofi.ogg"];
  fs.mkdirSync(path.join(dir, "vendor", "audio"), {recursive: true});
  AUDIO.forEach(f => fs.copyFileSync(path.join("vendor", "audio", f), path.join(dir, "vendor", "audio", f)));
  console.log("✅ 云端产物已写入 cloud/hosting/（index.html + manifest + sw.js + %d 个音源，预缓存 %d 项）",
    AUDIO.length, shell.length);
}

/* Tauri 桌面版：完整文件夹拷贝（含场景视频/窗景页/3D 书架），与网页文件夹版功能 100% 一致 */
if(process.argv.includes("--tauri")){
  const dir = safePath("desktop/dist");
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  fs.copyFileSync("index.html", path.join(dir, "index.html"));
  fs.copyFileSync("manifest.webmanifest", path.join(dir, "manifest.webmanifest"));
  for(const d of ["css", "js", "vendor"]) fs.cpSync(d, path.join(dir, d), {recursive: true});
  /* 桌面版提醒卡：Rust 侧用 WebviewWindow 加载它（便携模式下代替系统通知）。
     只在桌面产物里，网页版 / 单文件 / 云端都不带 —— 它也不加载工作台的任何脚本 */
  fs.copyFileSync("desktop/toast.html", path.join(dir, "toast.html"));
  console.log("✅ Tauri 完整目录产物已写入 desktop/dist/（与文件夹版同一份资源）");
}

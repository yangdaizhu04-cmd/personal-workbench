/* tools/watch.mjs —— 开发 watch：js / islands(jsx) 变化时自动做语法门禁（改动即查错）
   用法：node tools/watch.mjs
   为何只有语法门禁：完整冒烟（test-smoke）较重，适合改动告一段落时手动跑；
   watch 的价值是把「语法错」这种 0 成本就能抓住的问题在保存那一刻拦下来。
   监听范围：js/**（node --check）、islands/*.jsx（esbuild transform 解析）。
   css 不纳入：没有等价的轻量语法检查手段（浏览器会跳过坏规则、不影响加载），
   监听它只会触发无意义的 js 重检（L2）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { transformSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCH = [
  path.join(ROOT, "js"),
  path.join(ROOT, "islands"),
];
const DEBOUNCE = 200;

let timer = null;
function onChange(){   // fs.watch 回调的 (eventType, filename) 不声明即可，避免未用参数警告
  clearTimeout(timer);
  timer = setTimeout(() => checkAll(), DEBOUNCE);
}
/* js 走 node --check；jsx 走 esbuild transformSync（只解析不产出，检测语法错） */
function syntaxOk(file){
  if(file.endsWith(".jsx")){
    try{ transformSync(fs.readFileSync(file, "utf8"), {loader: "jsx"}); return true; }
    catch(e){ return false; }
  }
  return spawnSync("node", ["--check", file], {stdio: "ignore"}).status === 0;
}
function checkAll(){
  const t0 = Date.now();
  const files = collectSources();
  const bad = files.filter(f => !syntaxOk(f));
  if(bad.length){
    console.error("✗ 语法错误 " + bad.length + " 个文件：");
    bad.forEach(f => console.error("  " + path.relative(ROOT, f)));
    return;
  }
  console.log("✓ 语法门禁通过（" + files.length + " 个 js/jsx，" + (Date.now() - t0) + "ms） — " + new Date().toLocaleTimeString());
}
function collectSources(){
  const out = [];
  const walk = dir => {
    for(const e of fs.readdirSync(dir, {withFileTypes: true})){
      const p = path.join(dir, e.name);
      if(e.isDirectory()) walk(p);
      else if(e.name.endsWith(".js") || e.name.endsWith(".jsx")) out.push(p);
    }
  };
  for(const dir of WATCH){
    if(!fs.existsSync(dir)) continue;
    walk(dir);
  }
  return out;
}

for(const dir of WATCH){
  if(!fs.existsSync(dir)) continue;
  fs.watch(dir, {recursive: true}, onChange);
}
console.log("⌚ watch 运行中（js / islands jsx），Ctrl+C 退出");
checkAll();

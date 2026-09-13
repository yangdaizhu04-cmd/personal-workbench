/* build-islands.mjs —— 把 islands/*.jsx 打包成普通 IIFE 脚本（file:// 双击版可直接 <script> 加载）
   React 组件源来自本地 ThreeUI 仓库（../../../灵感开发项目一/threeui，MIT）。
   仓库不存在时跳过（vendor/threeui/islands/ 内有已提交的构建产物可用）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THREEUI = path.resolve(ROOT, "../../灵感开发项目一/threeui");
const NPM = path.join(THREEUI, "node_modules");
const OUT = path.join(ROOT, "vendor/threeui/islands");

if (!fs.existsSync(path.join(THREEUI, "package.json"))) {
  console.warn("⚠ 未找到 ThreeUI 仓库，跳过 islands 构建（使用 vendor/threeui/islands 已提交产物）");
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: fs.existsSync(NPM) ? [NPM] : [],
  absWorkingDir: ROOT,
  logLevel: "warning",
};

await esbuild.build({ entryPoints: ["islands/core.jsx"], outfile: path.join(OUT, "core.js"), ...common });
await esbuild.build({ entryPoints: ["islands/shelf.jsx"], outfile: path.join(OUT, "shelf.js"), ...common });
console.log("✅ islands 构建完成 → vendor/threeui/islands/");
for (const f of ["core.js", "shelf.js"]) {
  const p = path.join(OUT, f);
  if (fs.existsSync(p)) console.log("   " + f + " " + Math.round(fs.statSync(p).size / 1024) + " KB");
}

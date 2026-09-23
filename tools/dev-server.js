/* tools/dev-server.js —— 本地静态服务：给「双开同步」用。
   file:// 直开时每个文件的 localStorage 互相隔离，两个标签页无法共享数据；
   走 http 同源后，02-store.js 的 storage 监听才能收到另一窗口的改动。
   端口被占用时静默退出（视为已有实例在服务，浏览器直接复用），所以重复双击启动脚本不会起两份。 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2]) || 8765;
const ROOT = process.cwd();   // 启动脚本会先 pushd 到项目根
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try{ urlPath = decodeURIComponent((req.url || "/").split("?")[0]); }
  catch(e){ res.writeHead(400); return res.end(); }
  if(urlPath === "/") urlPath = "/index.html";
  const fp = path.join(ROOT, urlPath);
  if(!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, {"Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream"});
  fs.createReadStream(fp).pipe(res);
});

/* 端口被占用 = 已经有一个实例在服务（重复双击启动脚本），静默退出 */
server.on("error", () => process.exit(0));
server.listen(PORT, "127.0.0.1", () => {
  /* 静默运行：窗口由启动脚本以最小化方式持有 */
});

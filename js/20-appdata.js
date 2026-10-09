/* 20-appdata.js —— App 数据护城河（Capacitor 专属，Web 下整体 no-op）

   为什么需要：App 里 WebView 的 localStorage/IndexedDB 存在 app_webview 目录，
   WebView 组件更新、系统清缓存时可能被**单独**清掉（SharedPreferences 通常不受影响）；
   而 <a download> 在 App 里触发不了下载（WebView 没有 DownloadListener）。
   两条防线：
   ① Preferences 镜像：全量数据（剔除敏感键）定期镜像到原生，启动发现本机空了就拉回 —— 防"WebView 数据被单独清"；
   ② 系统分享导出：JSON/MD/CSV/zip 写 Filesystem(CACHE) 后调系统分享 —— 防"卸载/换机"的最终出口。

   形态隔离：__WB_APP__ 编译期裸标识符，--app 构建注入 true，其余形态 typeof 兜底 false。
   敏感键复用 store.exportAll 的单一口径（SECRET_KEYS），这里不另写过滤。 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const isApp = typeof __WB_APP__ !== "undefined" && __WB_APP__;

function plug(name){
  try{
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins[name]) || null;
  }catch(e){ return null; }
}

/* ---------- ① 本机镜像：localStorage → Preferences ---------- */
const MIRROR_KEY = "wb-mirror";
let mirrorTimer = null;

function mirror(){
  if(!isApp) return;
  const p = plug("Preferences");
  if(!p || !p.set) return;
  try{
    const json = JSON.stringify(WB.store.exportAll());
    p.set({key: MIRROR_KEY, value: json}).catch(() => {});
  }catch(e){ console.warn("[appData] 镜像写入失败", e); }
}
function scheduleMirror(delay){
  if(!isApp) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(mirror, delay === undefined ? 3000 : delay);
}
/* 本机 wb: 业务键数量（排除网络缓存与 schema 版本号）。0 = 数据被清空过。 */
function dataKeyCount(){
  let n = 0;
  try{
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(k && k.startsWith("wb:") && !k.startsWith("wb:netcache:") && k !== "wb:schemaVersion") n++;
    }
  }catch(e){}
  return n;
}
/* 启动恢复：仅在本机数据为空时从镜像拉回。有数据绝不覆盖 ——
   否则会拿旧镜像盖掉用户后来新写的数据。 */
async function restoreFromMirror(){
  if(!isApp) return false;
  if(dataKeyCount() > 0) return false;
  const p = plug("Preferences");
  if(!p || !p.get) return false;
  try{
    const res = await p.get({key: MIRROR_KEY});
    const val = res && res.value;
    if(!val) return false;
    const data = JSON.parse(val);
    WB.store.importAll(data);
    if(WB.ui && WB.ui.toast) WB.ui.toast("已从本机备份恢复数据 ✦", "ok");
    return true;
  }catch(e){ console.warn("[appData] 镜像恢复失败", e); return false; }
}

/* ---------- ② 系统分享导出 ----------
   content 可能是字符串（JSON/MD/CSV）或 Blob（Obsidian zip）。字符串走 UTF-8，Blob 转 base64。 */
async function saveAndShare(name, content, _mime){
  if(!isApp) return false;
  const fs = plug("Filesystem");
  if(!fs || !fs.writeFile) return false;
  try{
    let data = content, encoding;
    if(content instanceof Blob){
      data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
        r.onerror = () => reject(new Error("read blob failed"));
        r.readAsDataURL(content);
      });
      /* 不传 encoding = base64/binary 模式（Blob 的 base64 走这条） */
      encoding = undefined;
    }else{
      data = String(content);
      /* 字符串必须显式 UTF8：不传 encoding 时插件把 data 当 base64 解码，
         普通 JSON 字符串直接报 "input parameters aren't valid"（踩坑 M04） */
      encoding = "utf8";
    }
    const file = await fs.writeFile({path: name, data, directory: "CACHE", encoding, recursive: true});
    const sh = plug("Share");
    if(sh && sh.share){
      await sh.share({title: "个人工作台", text: name, files: [file.uri]});
    }
    return true;
  }catch(e){ console.warn("[appData] 分享导出失败", e); return false; }
}

if(isApp){
  /* 启动时异步恢复（不阻塞首屏）；数据被清场景恢复成功后重载，让数据与 schema 迁移生效 */
  setTimeout(() => { restoreFromMirror().then(restored => { if(restored) location.reload(); }); }, 0);
  /* 镜像触发：数据导入后防抖 + 每 60s 兜底 + App 退后台立即落一次。
     退后台走 app:state（19-app.js 的 appStateChange 广播）而非 pagehide ——
     Android WebView 里 pagehide 在切后台时不一定触发（踩坑 M03）。 */
  WB.bus.on("data:imported", () => scheduleMirror(500));
  setInterval(mirror, 60 * 1000);
  WB.bus.on("app:state", s => { if(s && !s.isActive) mirror(); });
  addEventListener("pagehide", mirror);
}

WB.appData = { available: () => isApp, mirror, restoreFromMirror, saveAndShare };
})();

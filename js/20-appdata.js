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

/* Blob → base64（去 data: 前缀）。音乐 / zip 等二进制写 Filesystem 前都要走这里。 */
function blobToBase64(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("read blob failed"));
    r.readAsDataURL(blob);
  });
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
      data = await blobToBase64(content);
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

/* ---------- ③ 本地音乐迁原生 Filesystem（WB.musicFile 抽象层） ----------
   音乐是唯一的大文件资产（几百 MB）：IndexedDB 在 WebView 里配额小、且随 WebView
   数据一起被清；迁到 Filesystem(DATA) 更稳。**所有形态都挂 WB.musicFile** ——
   Web 下委托 IndexedDB（行为不变），App 下走 Filesystem。元数据 musicList 仍在
   localStorage 不变。写失败一律降级回 IndexedDB，绝不让"加音乐"变成坏功能。 */
const MUSIC_DIR = "music";
function musicExt(name){ const m = String(name || "").match(/\.([A-Za-z0-9]+)$/); return m ? "." + m[1] : ""; }

async function musicPut(id, file){
  if(!isApp) return WB.idb.put("music:" + id, file, {name: file.name});
  const fs = plug("Filesystem");
  if(!fs || !fs.writeFile) return WB.idb.put("music:" + id, file, {name: file.name});
  try{
    const b64 = await blobToBase64(file);
    const path = MUSIC_DIR + "/" + id + musicExt(file.name);
    await fs.writeFile({path, data: b64, directory: "DATA", recursive: true});
    return true;
  }catch(e){
    console.warn("[musicFile] Filesystem 写入失败，降级 IndexedDB", e);
    return WB.idb.put("music:" + id, file, {name: file.name});
  }
}
async function musicUrl(id){
  if(!isApp){
    const rec = await WB.idb.get("music:" + id);
    return (rec && rec.data) ? URL.createObjectURL(rec.data) : null;
  }
  const fs = plug("Filesystem");
  if(!fs) return null;
  try{
    const res = await fs.readdir({path: MUSIC_DIR, directory: "DATA"}).catch(() => null);
    const hit = ((res && res.files) || []).find(f => f.name && String(f.name).indexOf(id + ".") === 0);
    if(!hit) return null;
    const u = await fs.getUri({path: MUSIC_DIR + "/" + hit.name, directory: "DATA"});
    const C = window.Capacitor;
    return (C && C.convertFileSrc) ? C.convertFileSrc(u.uri) : u.uri;
  }catch(e){ console.warn("[musicFile] 读取失败", e); return null; }
}
async function musicRemove(id){
  if(!isApp) return WB.idb.del("music:" + id);
  const fs = plug("Filesystem");
  if(!fs) return false;
  try{
    const res = await fs.readdir({path: MUSIC_DIR, directory: "DATA"}).catch(() => null);
    const hit = ((res && res.files) || []).find(f => f.name && String(f.name).indexOf(id + ".") === 0);
    if(hit) await fs.deleteFile({path: MUSIC_DIR + "/" + hit.name, directory: "DATA"});
    return true;
  }catch(e){ console.warn("[musicFile] 删除失败", e); return false; }
}

/* ---------- ④ 到点提醒（Local Notifications，绝对时间调度） ----------
   Android 的 LocalNotifications 走 AlarmManager，App 退后台/被杀也能触发 —— 比
   靠 WebView 心跳可靠。清单口径复用 18-desktop.js 的 buildList（纯函数、平台无关、
   所有形态都挂载），去重也复用同一套 fired 记账键，避免"桌面一套、App 又一套"漂移。
   通知 id 必须是非负整数，用哈希从字符串 rid 派生（碰撞概率可忽略）。 */
let lnAsked = false, lnSyncing = false, lnLastJson = "", lnSeq = 0, notifTimer = null;
const pendingClicks = new Map();          // 立即通知的 onClick（函数不可序列化，只能内存存）

function hashId(rid){
  const s = String(rid);
  let h = 0;
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2000000000) + 1;
}
/* 已发提醒的记账（与 18-desktop.js 的 firedIds 同口径：待办存 t.id、其余原样存 id） */
function firedSet(){
  const today = WB.bizDate();
  const s = new Set(WB.store.get("firedDesktop:" + today, []));
  WB.store.get("firedReminders:" + today, []).forEach(id => s.add("todo:" + id + ":" + today));
  return s;
}
async function ensureNotifyPerm(){
  const ln = plug("LocalNotifications");
  if(!ln) return false;
  try{
    let perm = await ln.checkPermissions();
    if(perm && perm.display === "granted") return true;
    if(lnAsked) return false;             // 只弹一次系统权限框
    lnAsked = true;
    perm = await ln.requestPermissions();
    return !!(perm && perm.display === "granted");
  }catch(e){ return false; }
}
/* 立即通知：前台提醒走这条（01-utils.js 的 notify → WB.app.notify → 这里） */
async function notifyNative(title, body, onClick){
  if(!isApp) return false;
  const ln = plug("LocalNotifications");
  if(!ln) return false;
  if(!await ensureNotifyPerm()) return false;
  try{
    const rid = "now:" + (++lnSeq);
    if(onClick) pendingClicks.set(rid, onClick);
    await ln.schedule({notifications: [{
      id: hashId(rid), title: String(title || "个人工作台"), body: String(body || ""),
      schedule: {at: new Date(Date.now() + 400)}, extra: {rid},
    }]});
    return true;
  }catch(e){ console.warn("[appNotify] 立即通知失败", e); return false; }
}
/* 后台预排：把未来 7 天的提醒清单交给系统闹钟。只排未来的 ——
   到点但仍在有效期内的那些由前台 checkReminders 发，排给系统会立刻补发、与前台重复。 */
async function syncNotifications(force){
  if(!isApp || lnSyncing) return;
  const ln = plug("LocalNotifications");
  if(!ln) return;
  lnSyncing = true;
  try{
    if(!await ensureNotifyPerm()) return;
    const list = (WB.desktop && WB.desktop.buildList) ? WB.desktop.buildList() : [];
    const now = Date.now();
    const fired = firedSet();
    const pending = list.filter(r => r.at > now && !fired.has(r.id)).slice(0, 60);
    const json = JSON.stringify(pending.map(r => [r.id, r.at]));
    if(!force && json === lnLastJson) return;         // 清单没变不重排（同桌面版 3s 防抖之外的二次去重）
    const cur = await ln.getPending().catch(() => null);
    const curN = (cur && cur.notifications) || [];
    if(curN.length) await ln.cancel({notifications: curN.map(n => ({id: n.id}))}).catch(() => {});
    const notifications = pending.map(r => ({
      id: hashId(r.id), title: String(r.title || "个人工作台"), body: String(r.body || ""),
      schedule: {at: new Date(r.at), allowWhileIdle: true},   // allowWhileIdle：Doze 下也能到点
      extra: {rid: r.id},
    }));
    if(notifications.length) await ln.schedule({notifications});
    lnLastJson = json;
  }catch(e){ console.warn("[appNotify] 通知清单同步失败", e); }
  finally{ lnSyncing = false; }
}
function scheduleNotifications(delay){
  if(!isApp) return;
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => syncNotifications(false), delay === undefined ? 3000 : delay);
}
/* 点通知：前台那条走内存里的 onClick；后台预排的按 rid 前缀跳页 */
function onNotificationAction(e){
  const extra = (e && e.notification && e.notification.extra) || {};
  const rid = String(extra.rid || "");
  const cb = pendingClicks.get(rid);
  if(cb){ pendingClicks.delete(rid); try{ cb(); }catch(err){} return; }
  if(rid.indexOf("todo:") === 0){ WB.router.go("todos"); }
  else if(rid.indexOf("cd:") === 0){ WB.router.go("countdown"); }
}

/* ---------- ⑤ 屏幕常亮（Screen Wake Lock API，无需插件） ----------
   番茄专注/休息计时运行中保持屏幕常亮，暂停/结束释放。页面不可见时浏览器会自动
   释放，回前台要重新申请 —— 所以 app:state 恢复时也重试一次。不支持的 WebView 静默。 */
let wakeLock = null;
async function syncWakeLock(want){
  if(!isApp || !("wakeLock" in navigator)) return;
  try{
    if(want && !wakeLock){
      wakeLock = await navigator.wakeLock.request("screen");
      if(wakeLock.addEventListener) wakeLock.addEventListener("release", () => { wakeLock = null; });
    }else if(!want && wakeLock){
      const w = wakeLock; wakeLock = null;
      await w.release();
    }
  }catch(e){ /* 用户拒绝/不可用：静默降级 */ }
}
const phaseRunning = p => typeof p === "string" && p.indexOf("-running") >= 0;

/* ---------- ⑥ 环境音：退后台暂停、回前台恢复 ----------
   只在退后台时确实在播才记标记、才恢复 —— 否则会把"用户本来没在播"变成
   "回前台自动响起来"。只动环境音（番茄七路），本地音乐/音频库是用户自己放的，不碰。 */
let bgWasPlaying = false;

if(isApp){
  /* 启动时异步恢复（不阻塞首屏）；数据被清场景恢复成功后重载，让数据与 schema 迁移生效 */
  setTimeout(() => { restoreFromMirror().then(restored => { if(restored) location.reload(); }); }, 0);

  /* 镜像触发：数据导入后防抖 + 每 60s 兜底（退后台再由 app:state 立即落一次） */
  WB.bus.on("data:imported", () => scheduleMirror(500));
  setInterval(mirror, 60 * 1000);

  /* 到点提醒：启动后排一次 + 数据变化防抖重排 + 每 30 分钟兜底 */
  setTimeout(() => syncNotifications(true), 3500);
  WB.bus.on("view:dirty", () => scheduleNotifications());
  WB.bus.on("settings:changed", () => scheduleNotifications(1200));
  setInterval(() => syncNotifications(true), 30 * 60 * 1000);
  const ln = plug("LocalNotifications");
  if(ln && ln.addListener) ln.addListener("localNotificationActionPerformed", onNotificationAction);

  /* 屏幕常亮：跟随番茄相位（专注/休息计时中常亮，暂停/结束释放） */
  let curPhase = "idle";
  WB.bus.on("pomo:phase", e => { curPhase = (e && e.phase) || "idle"; syncWakeLock(phaseRunning(curPhase)); });

  /* 退后台：镜像立即落一次 + 环境音暂停；回前台：恢复环境音 + 重排通知 + 若在计时重新申请常亮。
     退后台走 app:state（19-app.js 的 appStateChange 广播）而非 pagehide ——
     Android WebView 里 pagehide 在切后台时不一定触发（踩坑 M03）。 */
  WB.bus.on("app:state", s => {
    if(!s) return;
    if(!s.isActive){
      mirror();
      if(WB.sound && WB.sound.anyPlaying && WB.sound.anyPlaying()){ bgWasPlaying = true; WB.sound.muteAll(); }
    }else{
      if(bgWasPlaying){ bgWasPlaying = false; if(WB.sound && WB.sound.restoreCombo) WB.sound.restoreCombo(); }
      syncNotifications(true);
      syncWakeLock(phaseRunning(curPhase));
    }
  });
  addEventListener("pagehide", mirror);
}

WB.appData = { available: () => isApp, mirror, restoreFromMirror, saveAndShare,
  notifyNative, syncNotifications };
/* 音乐抽象层：所有形态都挂（Web 委托 idb，App 走 Filesystem），sound.js 只认这一个出口 */
WB.musicFile = { put: musicPut, url: musicUrl, remove: musicRemove };
})();

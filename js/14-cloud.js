/* 14-cloud.js —— 云端引擎（仅云端版生效）：密码门 / 自动双向同步 / 快照 / PWA 注册
   本地 file:// 双击版：本文件整体静默不激活 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

const isFile = location.protocol === "file:";
const baseUrl = (window.WB_ENV && window.WB_ENV.cloudBaseUrl) || "";
const available = !isFile && !!baseUrl;

const SYNC_KEYS = [
  "todos", "todoLists", "habits", "habitLogs", "journals", "moods", "notes",
  "ledger", "ledgerCats", "links", "texts", "goals", "countdowns", "wishes",
  "media", "health", "skills", "pomoLog", "badges", "weekReports", "doodles",
  "settings", "uiPrefs",
];

function token(){ return localStorage.getItem("wb:token") || ""; }
function setToken(t){ t ? localStorage.setItem("wb:token", t) : localStorage.removeItem("wb:token"); }

async function call(fn, payload){
  try{
    const res = await fetch(baseUrl + "/" + fn, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    if(!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }catch(e){
    return {ok: false, message: e.message};
  }
}

/* ---------- 编码 / 解码（本地 ↔ 同步格式） ---------- */
function encodeKey(val){
  const records = {};
  if(Array.isArray(val)){
    val.forEach(r => { if(r && r.id) records[r.id] = r; });
  }else if(val && typeof val === "object"){
    records.__kv = Object.assign({id: "__kv", updatedAt: Date.now()}, val);
  }
  return {records};
}
function decodeInto(key, payload, tombstones){
  const records = (payload && payload.records) || {};
  if(key === "settings" || key === "uiPrefs"){
    const kv = records.__kv;
    if(!kv) return false;
    const cur = WB.store.get(key, null);
    const curTs = (WB.store.get(key + ":__ts", 0));
    if(!cur || (kv.updatedAt || 0) > curTs){
      WB.store.set(key, Object.assign({}, kv, {id: undefined}));
      WB.store.set(key + ":__ts", kv.updatedAt || Date.now());
      return true;
    }
    return false;
  }
  const cur = WB.store.get(key, []);
  const map = new Map(cur.map(r => [r.id, r]));
  let changed = false;
  Object.values(records).forEach(r => {
    if(tombstones.has(r.id)) return;
    const old = map.get(r.id);
    if(!old){ map.set(r.id, r); changed = true; }
    else if((r.updatedAt || 0) > (old.updatedAt || 0)){ map.set(r.id, r); changed = true; }
  });
  if(changed) WB.store.set(key, Array.from(map.values()));
  return changed;
}
function tombstoneSet(){
  return new Set(WB.store.get("trash", []).map(t => t.data && t.data.id).filter(Boolean));
}

/* ---------- 同步动作 ---------- */
let syncing = false;
let lastSyncTs = WB.store.get("sync:since", 0);
let statusListeners = [];
function setStatus(s){
  const btn = WB.$("#btn-sync-state");
  if(btn) btn.textContent = s;
  statusListeners.forEach(f => { try{ f(s); }catch(e){} });
}

async function pushNow(){
  if(!available || !token() || syncing) return;
  syncing = true; setStatus("同步中…");
  const data = {};
  SYNC_KEYS.forEach(k => data[k] = encodeKey(WB.store.get(k, [])));
  const r = await call("sync", {action: "push", token: token(), data});
  syncing = false;
  setStatus(r.ok ? "已同步" : "同步失败");
}
async function pullNow(){
  if(!available || !token()) return;
  const r = await call("sync", {action: "pull", token: token(), since: lastSyncTs});
  if(!r.ok) { setStatus("同步失败"); return; }
  const tombs = tombstoneSet();
  let changed = false;
  Object.keys(r.data || {}).forEach(k => {
    if(!SYNC_KEYS.includes(k)) return;
    if(decodeInto(k, r.data[k], tombs)) changed = true;
  });
  lastSyncTs = r.serverTime || Date.now();
  WB.store.set("sync:since", lastSyncTs);
  setStatus("已同步");
  if(changed){
    WB.ui.toast("已从云端同步最新数据");
    WB.router.render();
  }
}

let pushTimer = null;
function schedulePush(){
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 3000);
}

/* ---------- 密码门 ---------- */
function gateModal(){
  return new Promise(resolve => {
    const body = WB.el("div");
    const pwd = WB.el("input", {type: "password", class: "input", placeholder: "设置访问密码（至少 4 位）",
      style: {fontSize: "17px", textAlign: "center", letterSpacing: "2px"}});
    body.appendChild(WB.el("p", {class: "small muted", style: {marginBottom: "12px", textAlign: "center"}},
      "这是你的云端数据空间，首次使用请设置访问密码。<br>同一密码的设备共享同一份数据。"));
    body.appendChild(pwd);
    const info = WB.el("div", {class: "small", style: {color: "var(--danger)", marginTop: "8px", textAlign: "center", minHeight: "18px"}});
    body.appendChild(info);
    const m = WB.ui.modal({title: "欢迎来到云端版", icon: "shield", content: body,
      onClose: () => resolve(false),
      actions: [{label: "进入", primary: true, onClick: async () => {
        const v = pwd.value.trim();
        if(v.length < 4){ info.textContent = "至少 4 位"; return true; }
        info.textContent = "验证中…";
        const r = await call("gate", {password: v});
        if(r.ok){
          setToken(r.token);
          m.close(); resolve(true);
        }else{
          info.textContent = r.message || "验证失败";
        }
        return true;
      }}]});
    setTimeout(() => pwd.focus(), 80);
  });
}

/* ---------- 启动 ---------- */
async function init(){
  if(!available){
    if(!isFile && !baseUrl){
      const btn = WB.$("#btn-sync-state");
      if(btn) btn.hidden = true;
    }
    return;
  }
  // PWA（manifest 动态注入，file:// 下不注入避免 CORS 报错）
  if("serviceWorker" in navigator){
    try{ navigator.serviceWorker.register("./sw.js"); }catch(e){}
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);
  }
  // 密码门
  if(!token()){
    const ok = await gateModal();
    if(!ok){ setStatus("未登录"); return; }
  }
  setStatus("同步中…");
  await pullNow();
  await pushNow();
  // 自动同步：数据变更 → push；定时 + 恢复联网 → pull
  WB.bus.on("data:changed", schedulePush);
  ["kv:todos","kv:todoLists","kv:habits","kv:habitLogs","kv:journals","kv:moods","kv:notes",
   "kv:ledger","kv:ledgerCats","kv:links","kv:texts","kv:goals","kv:countdowns","kv:wishes",
   "kv:media","kv:health","kv:skills","kv:pomoLog","kv:badges","kv:weekReports","kv:doodles",
   "kv:settings","kv:uiPrefs"].forEach(evt => WB.bus.on(evt, schedulePush));
  setInterval(pullNow, 5 * 60 * 1000);
  WB.bus.on("net:online", () => { pullNow(); });
}

/* ---------- 快照管理（设置页调用） ---------- */
const cloudApi = {
  available,
  async manualBackup(){
    if(!available){ WB.ui.toast("云端版才可用（本地版请用 JSON 导出）", "warn"); return; }
    if(!token()){ WB.ui.toast("请先输入访问密码", "warn"); return; }
    const data = {};
    SYNC_KEYS.forEach(k => data[k] = encodeKey(WB.store.get(k, [])));
    const r = await call("sync", {action: "snapshot", token: token(), data, tag: "手动备份 " + new Date().toLocaleString()});
    WB.ui.toast(r.ok ? "已备份到云 ✓（每日也会自动快照）" : "备份失败：" + r.message, r.ok ? "" : "warn");
    return r.ok;
  },
  async listSnapshots(){
    const r = await call("sync", {action: "snapshots", token: token()});
    return r.ok ? r.list : [];
  },
  async restoreSnapshot(ts){
    const r = await call("sync", {action: "restore", token: token(), ts});
    if(!r.ok){ WB.ui.toast("恢复失败", "warn"); return false; }
    WB.store.importAll(decodeSnapshot(r.data), {merge: false});
    WB.ui.toast("已恢复，正在刷新…");
    setTimeout(() => location.reload(), 900);
    return true;
  },
  onStatus(fn){ statusListeners.push(fn); },
  callProxy(payload){ return call("proxy", payload); },
  token,
};
function decodeSnapshot(data){
  const out = {};
  Object.keys(data || {}).forEach(k => {
    const records = (data[k] && data[k].records) || {};
    if(k === "settings" || k === "uiPrefs"){
      const kv = records.__kv;
      if(kv) out[k] = Object.assign({}, kv, {id: undefined});
    }else{
      out[k] = Object.values(records);
    }
  });
  return out;
}

WB.cloud = cloudApi;
setTimeout(init, 1200);
})();

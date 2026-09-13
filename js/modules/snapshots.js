/* modules/snapshots.js —— 数据快照：每日自动全量快照存 IndexedDB（保留 7 份）+ 一键恢复 + 导出提醒
   存储：wb-files 库 files store，key 前缀 "snapshot:日期"；内容为全部 wb: localStorage（排除 netcache） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const PREFIX = "snapshot:";
const KEEP = 7;

function collect(){
  const out = {};
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(!k || !k.startsWith("wb:") || k.startsWith("wb:netcache:")) continue;
    out[k] = localStorage.getItem(k);
  }
  return out;
}

async function take(label){
  const date = WB.bizDate();
  const data = collect();
  const json = JSON.stringify({__meta: {app: "个人工作台", kind: "snapshot", date, takenAt: Date.now(), label: label || "auto"}, data});
  await WB.idb.put(PREFIX + date, json, {type: "snapshot", bytes: json.length, label: label || "auto", ts: Date.now()});
  await prune();
  return {key: PREFIX + date, bytes: json.length};
}

async function prune(){
  const keys = (await WB.idb.allKeys(PREFIX)).sort();
  while(keys.length > KEEP){
    await WB.idb.del(keys.shift()); // 最旧的日期在前（YYYY-MM-DD 字典序）
  }
}

async function list(){
  const keys = (await WB.idb.allKeys(PREFIX)).sort().reverse();
  const out = [];
  for(const key of keys){
    const rec = await WB.idb.get(key);
    out.push({
      key,
      date: key.slice(PREFIX.length),
      bytes: rec && rec.meta && rec.meta.bytes || (rec && rec.data && rec.data.length) || 0,
      label: rec && rec.meta && rec.meta.label || "",
      ts: rec && rec.meta && rec.meta.ts || 0,
    });
  }
  return out;
}

async function restore(key){
  const rec = await WB.idb.get(key);
  if(!rec || !rec.data){ WB.ui.toast("快照不存在", "warn"); return false; }
  let parsed;
  try{ parsed = JSON.parse(rec.data); }
  catch(e){ WB.ui.toast("快照损坏，无法恢复", "warn"); return false; }
  const ok = await WB.ui.confirmBox(
    "恢复会把本机数据覆盖为 " + key.slice(PREFIX.length) + " 的快照（快照之后产生的新数据会丢失，建议先导出 JSON）。确定恢复？",
    {danger: true, okLabel: "覆盖恢复"});
  if(!ok) return false;
  const snap = parsed.data || {};
  for(let i = localStorage.length - 1; i >= 0; i--){
    const k = localStorage.key(i);
    if(k && k.startsWith("wb:") && !k.startsWith("wb:netcache:") && !(k in snap)) localStorage.removeItem(k);
  }
  Object.keys(snap).forEach(k => localStorage.setItem(k, snap[k]));
  localStorage.setItem("wb:settings", localStorage.getItem("wb:settings") || "{}");
  location.reload();
  return true;
}

async function remove(key){
  await WB.idb.del(key);
  WB.ui.toast("快照已删除");
}

/* 每日首次打开自动拍；顺带检查"超过 7 天没导出 JSON 文件"就提醒一次 */
async function maybeDaily(){
  try{
    const today = WB.bizDate();
    const has = (await WB.idb.allKeys(PREFIX)).includes(PREFIX + today);
    if(!has) await take("auto");
    const s = WB.theme.all();
    const last = s.lastExportTs || 0;
    const days = (Date.now() - last) / 86400000;
    const remindKey = "lastSnapRemindDay";
    if(days > 7 && WB.store.get(remindKey) !== today){
      WB.store.set(remindKey, today);
      setTimeout(() => WB.ui.toast("已经 " + Math.floor(days) + " 天没有导出 JSON 备份文件了，快照只在本机浏览器里，建议到 设置→数据管理 导出一份", "warn"), 3000);
    }
  }catch(e){ console.error("[snapshots] daily", e); }
}

WB.registerModule({id: "snapshots-internal", title: "数据快照", icon: "archive", hidden: true, render(){}});

WB.snapshots = {collect, take, list, restore, remove, prune, maybeDaily};
})();

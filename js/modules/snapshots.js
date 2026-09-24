/* modules/snapshots.js —— 数据快照：每日自动全量快照存 IndexedDB + 恢复前自动兜底 + 差异预览 + 选择性恢复
   存储：wb-files 库 files store，key 前缀 "snapshot:"；
   内容为全部 wb: localStorage（排除 netcache）——**不含 IndexedDB 里的大文件**（涂鸦/音乐/影视封面）

   2026-09-24（第五轮保留项 C2）三处改动，起因是三个真问题：
   ① 恢复自己**没有兜底**：其他覆盖入口（WebDAV 拉取 / JSON 导入 / 导入配置）都会先拍一张，
      唯独"恢复快照"这个最危险的动作不拍 → 点错了就永远回不去。现在恢复前一律先拍一张「恢复前」
   ② 恢复是**全有或全无**：想捞回上周误删的几条笔记，得把整个工作台退回三天前。
      现在可以先看差异（每个模块多几条少几条）再只恢复勾选的模块
   ③ 手动快照会**顶掉当天早上那份**：key 都是 `snapshot:日期`。现在自动一天一份、
      手动与「恢复前」另起 `snapshot:日期-HHMM`，两者并存 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const PREFIX = "snapshot:";
const KEEP = 10;              // 保留份数。手动与「恢复前」也占名额，7 份在多手动场景下一天就被挤空

/* ---------- 键与分组 ---------- */
function isData(k){ return !!k && k.startsWith("wb:") && !k.startsWith("wb:netcache:"); }
/* 分组 = 冒号前的名字：`wb:morningDone:2026-09-24` 与 `wb:morningDone:2026-09-23` 同组。
   差异列表按组展示（否则一天一个的标记键会把列表刷满），恢复也以组为单位 */
function groupOf(k){ return k.slice(3).split(":")[0]; }
/* 组的中文名。没收录的新键直接显示原名 —— 显示不出来比显示英文名更糟 */
const GROUP_CN = {
  todos: "待办", todoLists: "待办清单", habits: "习惯", habitLogs: "打卡记录",
  journals: "日志", moods: "心情", notes: "笔记", tags: "标签",
  ledger: "账本", ledgerCats: "账本分类", links: "收藏链接", texts: "文本速记",
  goals: "目标", countdowns: "倒数日", wishes: "愿望", review: "复习记录",
  media: "影视", podcasts: "播客", books: "书", health: "健康", skills: "技能",
  pomoLog: "番茄记录", interrupts: "打断记录", badges: "徽章", weekReports: "周报存档",
  doodles: "涂鸦", rssSources: "订阅源", companion: "小雾团记忆",
  settings: "设置", uiPrefs: "界面偏好", webdav: "WebDAV 配置", cloud: "云端配置",
  trash: "回收站", firedReminders: "已提醒标记", firedDesktop: "已提醒标记",
  morningDone: "晨间仪式标记", offworkDone: "收工标记", reviewAsked: "复习提示标记",
  lastSnapRemindDay: "备份提醒标记",
};
function groupName(g){ return GROUP_CN[g] || g; }
/* 配置类（丢了要重新设一遍）与记录类（丢了就是没了）在差异表里说法不同：
   前者"回到默认"，后者"会被清空" —— 一句"会少掉 1 条"两种都说不清 */
const CONFIG_GROUPS = {settings: 1, uiPrefs: 1, webdav: 1, cloud: 1, ambiencePlan: 1};
function isConfig(g){ return !!CONFIG_GROUPS[g]; }

function collect(){
  const out = {};
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(!isData(k)) continue;
    out[k] = localStorage.getItem(k);
  }
  return out;
}
/* 一条 wb: 里装了几笔：数组算长度，对象算键数，其余算 1 笔（设置就是一个对象） */
function countOf(raw){
  if(raw === undefined || raw === null) return 0;
  try{
    const v = JSON.parse(raw);
    if(Array.isArray(v)) return v.length;
    if(v && typeof v === "object") return Object.keys(v).length;
    return 1;
  }catch(e){ return 1; }
}

/* ---------- 拍 / 列 / 删 ---------- */
function stamp(){
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join("");
}
async function take(label){
  const date = WB.bizDate();
  const isAuto = !label || label === "auto";
  /* 自动：一天一份（当天首次打开那一刻的状态）
     手动/恢复前：`日期-HHMMSS` 另起一份，不把早上那份顶掉 —— 早上那份才是回退损失最小的。
     **精确到秒并且撞了就加序号**：只到分钟时，同一分钟内连着两次恢复会互相覆盖，
     而"恢复前"那张正是用来反悔的，被覆盖掉等于安全网自己把自己踩了 */
  let key = isAuto ? PREFIX + date : PREFIX + date + "-" + stamp();
  if(!isAuto){
    for(let i = 2; await WB.idb.get(key); i++) key = PREFIX + date + "-" + stamp() + "-" + i;
  }
  const data = collect();
  const json = JSON.stringify({__meta: {app: "个人工作台", kind: "snapshot", date, takenAt: Date.now(), label: label || "auto"}, data});
  await WB.idb.put(key, json, {type: "snapshot", bytes: json.length, label: label || "auto", ts: Date.now()});
  await prune();
  return {key, bytes: json.length};
}

async function prune(){
  const keys = (await WB.idb.allKeys(PREFIX)).sort();
  while(keys.length > KEEP){
    await WB.idb.del(keys.shift()); // 最旧的日期在前（YYYY-MM-DD 字典序，同日后缀排序在后）
  }
}

async function list(){
  const keys = (await WB.idb.allKeys(PREFIX)).sort().reverse();
  const out = [];
  for(const key of keys){
    const rec = await WB.idb.get(key);
    const raw = key.slice(PREFIX.length);          // 2026-09-24 或 2026-09-24-1530
    const dash = raw.indexOf("-", 8);
    out.push({
      key,
      date: dash > 0 ? raw.slice(0, dash) : raw,
      time: dash > 0 ? raw.slice(dash + 1) : "",
      bytes: rec && rec.meta && rec.meta.bytes || (rec && rec.data && rec.data.length) || 0,
      label: rec && rec.meta && rec.meta.label || "",
      ts: rec && rec.meta && rec.meta.ts || 0,
    });
  }
  return out;
}

async function read(key){
  const rec = await WB.idb.get(key);
  if(!rec || !rec.data) return null;
  try{ return JSON.parse(rec.data); }
  catch(e){ return null; }
}

/* ---------- 差异：快照 vs 现在，按组给 ---------- */
async function diff(key){
  const parsed = await read(key);
  if(!parsed) return null;
  const snap = parsed.data || {};
  const cur = collect();
  const G = {};
  const touch = g => G[g] || (G[g] = {group: g, name: groupName(g), now: 0, then: 0,
    nowKeys: [], thenKeys: [], same: true, missingNow: false});
  Object.keys(cur).forEach(k => { const g = touch(groupOf(k)); g.now += countOf(cur[k]); g.nowKeys.push(k); });
  Object.keys(snap).forEach(k => { const g = touch(groupOf(k)); g.then += countOf(snap[k]); g.thenKeys.push(k); });
  Object.keys(G).forEach(g => {
    const G0 = G[g];
    /* 逐键比 JSON：条数一样不代表没变（改个字也算变），只是没法在几行字里说清改了哪条 */
    const all = new Set(G0.nowKeys.concat(G0.thenKeys));
    all.forEach(k => { if(cur[k] !== snap[k]) G0.same = false; });
    G0.delta = G0.then - G0.now;          // 正数 = 快照比现在多（恢复后会多出来）
    G0.changed = !G0.same;
    G0.missingNow = G0.thenKeys.length === 0;   // 现在有、快照里没有 → 恢复会把它清掉
  });
  const rows = Object.keys(G).map(g => G[g]).filter(r => r.changed);
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.now - a.now);
  return {key, date: key.slice(PREFIX.length), rows,
    changedKeys: rows.length, totalGroups: Object.keys(G).length,
    totalNow: rows.reduce((s, r) => s + r.now, 0), totalThen: rows.reduce((s, r) => s + r.then, 0)};
}

/* ---------- 恢复 ---------- */
async function restore(key, picks){
  const parsed = await read(key);
  if(!parsed){ WB.ui.toast("快照不存在或已损坏", "warn"); return false; }
  const snap = parsed.data || {};
  const only = picks && picks.length ? new Set(picks) : null;
  const label = key.slice(PREFIX.length);
  const what = only ? "只恢复勾选的 " + only.size + " 个模块（其余保持不动）"
    : "把本机数据覆盖为 " + label + " 的快照（快照之后产生的新数据会丢失）";
  const ok = await WB.ui.confirmBox(what + "<br><br>恢复前会先自动拍一张「恢复前」快照，万一不对可以再退回来。确定恢复？",
    {danger: true, okLabel: only ? "恢复勾选的" : "全部覆盖恢复"});
  if(!ok) return false;
  /* ① 先兜底：这一步是这次改动的核心。其他覆盖入口早就这么做了，只有恢复自己没有 */
  await take("恢复前");
  if(!only){
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(isData(k) && !(k in snap)) localStorage.removeItem(k);
    }
    Object.keys(snap).forEach(k => localStorage.setItem(k, snap[k]));
  }else{
    /* 选择性恢复的语义 = "把勾选的这几块退回快照时的状态"：
       快照里有 → 写回来；现在有而快照里没有 → 删掉（否则"退回那一刻"就不成立）；
       没勾的组一律不碰 */
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(isData(k) && only.has(groupOf(k)) && !(k in snap)) localStorage.removeItem(k);
    }
    Object.keys(snap).forEach(k => { if(only.has(groupOf(k))) localStorage.setItem(k, snap[k]); });
  }
  localStorage.setItem("wb:settings", localStorage.getItem("wb:settings") || "{}");
  location.reload();
  return true;
}

async function remove(key){
  await WB.idb.del(key);
  WB.ui.toast("快照已删除");
}

/* ---------- 规模提示 ---------- */
/* 快照里没有 IndexedDB 的大文件（涂鸦/上传的音乐/影视封面）。恢复前如实说清楚，
   免得出现"我恢复了他怎么没回来"的误解 */
async function bigFiles(){
  try{
    const keys = await WB.idb.allKeys("");
    return keys.filter(k => /^(doodle|music|cover):/.test(k)).length;
  }catch(e){ return 0; }
}

/* 每日首次打开自动拍；顺带检查"超过 7 天没导出 JSON 文件"就提醒一次 */
async function maybeDaily(){
  try{
    const today = WB.bizDate();
    const has = (await WB.idb.allKeys(PREFIX)).includes(PREFIX + today);
    if(!has) await take("auto");
    const s = WB.theme.all();
    /* 从未导出过时以「首次使用」为起点算天数：lastExportTs 默认 0 是 1970 年，
       直接算会弹出「已经 20719 天没有导出」这种荒谬文案（新用户第一天就撞上） */
    let last = s.lastExportTs || 0;
    if(!last){
      last = s.firstSeenTs || 0;
      if(!last){ last = Date.now(); WB.theme.set("firstSeenTs", last); }
    }
    const days = (Date.now() - last) / 86400000;
    const remindKey = "lastSnapRemindDay";
    if(days > 7 && WB.store.get(remindKey) !== today){
      WB.store.set(remindKey, today);
      const tip = s.lastExportTs
        ? "已经 " + Math.floor(days) + " 天没有导出 JSON 备份文件了，快照只在本机浏览器里，建议到 设置→数据管理 导出一份"
        : "还没有导出过备份文件：数据只在本机浏览器里，建议到 设置→数据管理 导出一份带走";
      setTimeout(() => WB.ui.toast(tip, "warn"), 3000);
    }
  }catch(e){ console.error("[snapshots] daily", e); }
}

WB.registerModule({id: "snapshots-internal", title: "数据快照", icon: "archive", hidden: true, render(){}});

WB.snapshots = {collect, take, list, read, diff, restore, remove, prune, maybeDaily, bigFiles,
  groupOf, groupName, isConfig};
})();

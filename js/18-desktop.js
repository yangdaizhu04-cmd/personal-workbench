/* 18-desktop.js —— 桌面版（Tauri）桥：把「提醒清单」推给 Rust 侧
   为什么需要它：桌面版关窗后窗口销毁、WebView 里的 JS 全停，
   于是所有提醒静默。数据又只在本机 localStorage 里，Rust 读不到 ——
   所以由前端把**算好的绝对时间戳清单**推过去，Rust 用后台线程到点发系统通知。

   分工（必须写死，否则一条提醒会响两次）：
   - 窗口可见且未最小化 → 前端自己发（main.js/checkReminders 与番茄的 notifyAll）
   - 窗口隐藏 / 最小化 / 已关窗 → Rust 发（前端在 checkReminders 开头直接 return）
   - 番茄结束**始终归前端**（它的 1 秒心跳在，不需要跨进程接力）

   清单只含"时刻类"四条：待办到点 · 倒数日与生日 · 晨间 · 收工。
   网页版 / 单文件版 / PWA / 扩展里这份文件整体静默（inTauri=false），零影响。 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* 桌面壳判断：Tauri 2 的 webview 里一定注入 __TAURI_INTERNALS__；
   开了 withGlobalTauri 之后才有 __TAURI__（我们不走 npm 包，只借这一个入口） */
const core = (window.__TAURI__ && window.__TAURI__.core) || null;
const inTauri = !!(window.__TAURI_INTERNALS__ || core);
const HORIZON = 7;            // 往后算几天：够撑过一整夜加一个周末
const MAX_ITEMS = 60;
const DAY_AT_HOUR = 9;        // 倒数日/生日当天的提醒时刻

function invoke(cmd, args){
  if(!inTauri) return Promise.resolve(null);
  if(core && core.invoke) return core.invoke(cmd, args);
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}
function pad2(n){ return String(n).padStart(2, "0"); }
/* 本地时间戳（不带 Z：new Date("2026-09-24T09:00:00") 按本地时区解析） */
function atOf(dateStr, h, m){
  const d = new Date(dateStr + "T" + pad2(h) + ":" + pad2(m) + ":00");
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
/* 待办「提前几分钟」与 main.js/checkReminders 必须同一张表 */
const AHEAD = {"0": 0, "5": 5, "10": 10, "30": 30};

function buildList(){
  const out = [];
  const now = Date.now();
  const today = WB.bizDate();
  const s = WB.theme.all();
  /* 每条提醒都带**有效期** `until`：到点后过了有效期就不再发。
     不给有效期的下场是"早上 8 点的晨间提醒"在深夜 11 点还会弹出来。（踩坑 #076） */
  const add = (id, at, until, title, body) => {
    if(!at || !until || until <= now) return;
    out.push({id, at, until, title, body});
  };
  const diffOf = d => WB.daysBetween(today, d);
  const dayEnd = d => atOf(d, 23, 59);

  /* ① 待办到点：只取未来 HORIZON 天里有时刻、未完成的。
     有效期与网页版 checkReminders 的窗口对齐（到点后 30 分钟内算数），
     否则关窗与开窗两种状态下"该不该提醒"会不一致 */
  WB.store.get("todos", []).forEach(t => {
    if(t.done || !t.time || !t.date) return;
    const diff = diffOf(t.date);
    if(diff < 0 || diff > HORIZON) return;
    const parts = String(t.time).split(":");
    const ahead = AHEAD[t.remindAhead] || 0;
    const onTime = atOf(t.date, Number(parts[0]), Number(parts[1]));
    add("todo:" + t.id + ":" + t.date, onTime - ahead * 60000, onTime + 30 * 60000,
      "⏰ 待办提醒", (ahead ? "还有 " + ahead + " 分钟" : "现在") + "：" + t.title);
  });

  /* ② 倒数日 / 生日：当天一条（有效期到当天结束 —— 晚上才打开也还赶得上知道）；
     生日另按「提前天数」再提醒一次。非生日的倒数日不提前刷屏，只当天说 */
  const aheadDays = Number(s.birthdayAhead) || 7;
  WB.store.get("countdowns", []).forEach(c => {
    const target = WB.countdown && WB.countdown.targetOf ? WB.countdown.targetOf(c, today) : c.date;
    if(!target) return;
    const diff = diffOf(target);
    if(diff < 0 || diff > HORIZON) return;
    const name = (c.isBirthday ? "🎂 " : "◷ ") + (c.name || "倒数日");
    if(diff === 0) add("cd:" + c.id + ":" + target, atOf(target, DAY_AT_HOUR, 0), dayEnd(target),
      name, "就是今天" + (c.note ? " · " + c.note : ""));
    else if(c.isBirthday && diff === aheadDays) add("cd:" + c.id + ":" + target,
      atOf(target, DAY_AT_HOUR, 0), dayEnd(target), name, "还有 " + diff + " 天 · 要不要准备点什么");
  });

  /* ③ 晨间 / 收工：每天一条；今天已经做过的那条不推（周末也算，不判断工作日）。
     有效期各给几小时：晨间到中午为止，收工到夜里为止 —— 过时不候，别在半夜补弹 */
  const mh = s.morningHour === undefined ? 8 : Number(s.morningHour);
  const oh = s.offworkHour === undefined ? 18 : Number(s.offworkHour);
  for(let i = 0; i <= HORIZON; i++){
    const d = WB.addDaysStr(today, i);
    if(!(i === 0 && WB.store.get("morningDone:" + d, false)))
      add("morning:" + d, atOf(d, mh, 0), atOf(d, mh, 0) + 4 * 60 * 60000,
        "☀ 晨间仪式", "先想清楚今天的三件事");
    if(!(i === 0 && WB.store.get("offworkDone:" + d, false)))
      add("offwork:" + d, atOf(d, oh, 0), atOf(d, oh, 0) + 5 * 60 * 60000,
        "🌙 该收工了", "今天到这儿，剩下的明天再说");
  }

  return out.sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS);
}

/* ---------- 推送（防抖：数据一动就推，但别每敲一个字推一次） ---------- */
let debounce = null;
let lastJson = "";
let fails = 0;
function sync(force){
  if(!inTauri) return Promise.resolve(0);
  if(WB.theme.all().desktopNotify === false){
    if(lastJson === "[]") return Promise.resolve(0);
    lastJson = "[]";
    return invoke("set_reminders", {list: []}).catch(() => 0);
  }
  const list = buildList();
  const json = JSON.stringify(list);
  if(!force && json === lastJson) return Promise.resolve(list.length);
  lastJson = json;
  return invoke("set_reminders", {list}).then(n => { fails = 0; return n; }, err => {
    /* 静默失败是这里最坏的结果：提醒一直不发，用户以为"就是没提醒"。
       打包后看不到 console，所以连挂三次就在界面上说一次 */
    console.warn("[desktop] 提醒清单推送失败", err);
    lastJson = "";    // 失败就别记住，下次重推
    if(++fails === 3) WB.ui.toast("后台提醒没接上：桌面端可能不是最新版本（关窗后将收不到提醒）", "warn");
    return 0;
  });
}
function schedule(delay){
  if(!inTauri) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => sync(), delay === undefined ? 3000 : delay);
}

/* ---------- 开机自启（设置页开关；走插件命令，不装 npm 包） ---------- */
function autostartGet(){
  return invoke("plugin:autostart|is_enabled").then(v => !!v, () => null);
}
function autostartSet(on){
  return invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable")
    .then(() => true, err => { console.warn("[desktop] 开机自启设置失败", err); return false; });
}
/* 自检：让 Rust 直接发一条通知，用来确认系统真的能弹出（比"理论上应该能"靠谱） */
function testNotify(){
  return invoke("test_notify").then(msg => ({ok: true, msg}), err => ({ok: false, msg: String(err)}));
}

/* ---------- 窗口可见时由前端自己发的那些 ----------
   待办到点归 main.js/checkReminders（它有自己的提前量与去重键），这里只管
   倒数日 / 生日 / 晨间 / 收工。同一条提醒**不能两边都发**，所以跳过 todo:*。
   只在桌面版生效：网页版没有"后台",给它加一条自己改不了时刻的晨间提醒没道理 */
function inWindow(){
  const key = "firedDesktop:" + WB.bizDate();
  const fired = new Set(WB.store.get(key, []));
  const now = Date.now();
  let changed = false;
  buildList().forEach(r => {
    if(r.id.indexOf("todo:") === 0) return;
    if(r.at > now || now > r.until || fired.has(r.id)) return;
    fired.add(r.id); changed = true;
    const shown = WB.notify(r.title, r.body);
    if(!shown && WB.theme.all().remindToast) WB.ui.toast(r.title + " · " + r.body, "warn");
  });
  if(changed) WB.store.set(key, Array.from(fired));
}

if(inTauri){
  /* 启动后推一次；数据变化（含设置改动）后防抖推；每 30 分钟重推一次兜底 */
  setTimeout(() => sync(true), 2500);
  WB.bus.on("view:dirty", () => schedule());
  WB.bus.on("settings:changed", () => schedule(1200));
  setInterval(() => sync(true), 30 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") schedule(600); });
}

WB.desktop = {
  available: () => inTauri,
  /* 窗口是否被藏起来（关窗收进托盘 / 最小化）。用来决定"这条提醒谁发" */
  hidden: () => !inTauri || document.visibilityState !== "visible",
  buildList, sync, schedule, inWindow, autostartGet, autostartSet, testNotify,
};
})();

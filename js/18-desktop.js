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
/* 清单上限。**必须一次装得下整个窗口**：被裁掉的那些在关窗后永远不会响，而裁剪是静默的
   （实测：7 天窗口里每天 7 条有时刻的待办就会撞上） */
const MAX_ITEMS = 200;
let truncated = 0;            // 上一次 buildList 被裁掉的条数（给 sync 提示用）
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
/* 提前量表与「到点后多久还算数」都只有一份，定义在 js/01-utils.js
   （WB.REMIND_AHEAD / WB.TODO_WINDOW_MIN）：main.js 的 checkReminders 读同一处 ——
   复制成两份就会漂，表现是开窗与关窗两种状态下提前量/有效期不一致 */
const AHEAD = WB.REMIND_AHEAD;

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
     有效期与网页版 checkReminders 的窗口对齐（到点后 WB.TODO_WINDOW_MIN 分钟内算数），
     否则关窗与开窗两种状态下"该不该提醒"会不一致 */
  WB.store.get("todos", []).forEach(t => {
    if(t.done || !t.time || !t.date) return;
    const diff = diffOf(t.date);
    if(diff < 0 || diff > HORIZON) return;
    const parts = String(t.time).split(":");
    const ahead = AHEAD[t.remindAhead] || 0;
    const onTime = atOf(t.date, Number(parts[0]), Number(parts[1]));
    add("todo:" + t.id + ":" + t.date, onTime - ahead * 60000, onTime + WB.TODO_WINDOW_MIN * 60000,
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

  const sorted = out.sort((a, b) => a.at - b.at);
  /* 裁掉的部分在关窗状态下永远不会响，而裁剪本来是静默的 → 记下条数，由 sync 在界面上说一次 */
  truncated = Math.max(0, sorted.length - MAX_ITEMS);
  return sorted.slice(0, MAX_ITEMS);
}

/* 前端已经发过的那些 id（窗口可见时 main.js 的 checkReminders 与下面的 inWindow 记的账）。
   推送前必须把它们排掉：Rust 只认自己那张**进程内**去重表（重启即清零），也不知道前端发过；
   不排的话就会"窗口可见时响过 → 关窗或重启 → Rust 在有效期内又响一次"。
   待办记账存的是 t.id，而清单里的 id 形如 todo:<id>:<date>，这里补成同一种形状 */
function firedIds(){
  const today = WB.bizDate();
  const s = new Set(WB.store.get("firedDesktop:" + today, []));
  WB.store.get("firedReminders:" + today, []).forEach(id => s.add("todo:" + id + ":" + today));
  return s;
}

/* ---------- 反方向：把 Rust 已经发过的补进前端记账（踩坑 #091） ----------
   上面 firedIds() 管的是"前端发过 → 别让 Rust 再发"；这里管"Rust 发过 → 别让前端再发"。
   两个方向缺一不可：Rust 的去重表只活在进程内存里，前端拿不到 —— 窗口收在托盘时响过的那条，
   恢复可见后前端只看得到自己那份记账，会在有效期内（待办 30 分钟、晨间 4 小时、收工 5 小时）再响一次。
   记账形状与 main.js / inWindow 对齐：待办存 t.id（键按 id 里带的那个日期），其余 id 原样存（键按业务日） */
const TODO_ID = /^todo:(.+):(\d{4}-\d{2}-\d{2})$/;
let firedMerging = 0;            // 正在补账的请求数：>0 时前端先别发提醒（门在 main.js/checkReminders）
function mergeFired(){
  if(!inTauri) return Promise.resolve(0);
  firedMerging++;
  return invoke("fired_ids").then(ids => {
    if(!Array.isArray(ids) || !ids.length) return 0;
    const today = WB.bizDate();
    const todoByDay = new Map();
    const desk = new Set(WB.store.get("firedDesktop:" + today, []));
    let added = 0, todoChanged = false, deskChanged = false;
    ids.forEach(id => {
      const m = TODO_ID.exec(id);
      if(m){
        if(!todoByDay.has(m[2])) todoByDay.set(m[2], new Set(WB.store.get("firedReminders:" + m[2], [])));
        const set = todoByDay.get(m[2]);
        if(!set.has(m[1])){ set.add(m[1]); added++; todoChanged = true; }
      }else if(!desk.has(id)){ desk.add(id); added++; deskChanged = true; }
    });
    /* 没有新增就不写：写一遍会白白触发 store 的监听（重绘/重推） */
    if(todoChanged) todoByDay.forEach((set, day) => WB.store.set("firedReminders:" + day, Array.from(set)));
    if(deskChanged) WB.store.set("firedDesktop:" + today, Array.from(desk));
    return added;
  }).catch(err => {
    /* 拉不到就照旧：宁可偶尔重复一次，也不能让这条命令把提醒整条链路卡住 */
    console.warn("[desktop] 已发提醒清单读取失败", err);
    return 0;
  }).then(n => { firedMerging--; return n; }, err => { firedMerging--; throw err; });
}
function firedPending(){ return firedMerging > 0; }
/* 补账 + 广播：调用方（main.js/checkReminders）靠这条广播解开"先别发"的门 */
function syncFired(){
  return mergeFired().then(n => { WB.bus.emit("reminders:synced", {added: n}); return n; });
}

/* ---------- 推送（防抖：数据一动就推，但别每敲一个字推一次） ---------- */
let debounce = null;
let lastJson = "";
let fails = 0;
let truncatedNoted = 0;   // 已经提示过的截断条数（相同就不再刷屏）
function noteTruncated(){
  if(!truncated || truncated === truncatedNoted) return;
  truncatedNoted = truncated;
  WB.ui.toast("后台提醒清单已满（上限 " + MAX_ITEMS + " 条），另有 " + truncated +
    " 条在关窗后不会提醒 —— 可到设置里把提醒时刻精简一下", "warn");
}
function sync(force){
  if(!inTauri) return Promise.resolve(0);
  if(WB.theme.all().desktopNotify === false){
    if(lastJson === "[]") return Promise.resolve(0);
    lastJson = "[]";
    return invoke("set_reminders", {list: []}).catch(() => 0);
  }
  const done = firedIds();
  const list = buildList().filter(r => !done.has(r.id));
  noteTruncated();
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
/* 窗口可见时前端把提醒交给 Rust 走同一条通道。
   前端**不能**自己 `new Notification()`：WebView2 里那个调用不会显示任何东西
   （要宿主实现通知回调，Tauri 没实现），于是"应用开着"时提醒是静默的（踩坑 #079） */
let notifyFailAt = 0;
function notifyNow(title, body){
  if(!inTauri) return Promise.resolve(false);
  return invoke("notify_now", {title, body}).then(() => true, err => {
    console.warn("[desktop] 提醒发送失败", err);
    /* 窗口可见时这条提醒只走应用内（#079 的纪律：失败必须看得见）。前端拿的是同步布尔值，
       拿不到这里的结果，所以失败至少要自己冒一声；60 秒内只冒一次，别刷屏 */
    if(Date.now() - notifyFailAt > 60000){
      notifyFailAt = Date.now();
      if(WB.ui && WB.ui.toast) WB.ui.toast("这条提醒没能弹出来（桌面通道没接上，详见 fired.log）", "warn");
    }
    return false;
  });
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
    const shown = WB.notify(r.title, r.body);
    const fallback = !shown && WB.theme.all().remindToast;
    if(fallback) WB.ui.toast(r.title + " · " + r.body, "warn");
    /* 什么都没显示出来就不记账：通道哑掉时留一次机会给下一轮（踩坑 #079 顺带修的） */
    if(!shown && !fallback) return;
    fired.add(r.id); changed = true;
  });
  if(changed) WB.store.set(key, Array.from(fired));
}

if(inTauri){
  /* 启动后推一次；数据变化（含设置改动）后防抖推；每 30 分钟重推一次兜底。
     每次推送前都先补一次账（Rust 在隐藏期间发过的那几条）——顺序反了就会把刚补上的又推回去 */
  setTimeout(() => syncFired().then(() => sync(true)), 2500);
  WB.bus.on("view:dirty", () => schedule());
  WB.bus.on("settings:changed", () => schedule(1200));
  setInterval(() => syncFired().then(() => sync(true)), 30 * 60 * 1000);
  /* 从隐藏变可见：先补账、再重推清单，并把"门可以开了"广播出去（main.js 的 checkReminders 在等它）。
     补账必须在重推之前 —— 反过来的话，重推的那份清单里还带着 Rust 已经发过的条目 */
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState !== "visible") return;
    syncFired().then(() => schedule(600));
  });
}

WB.desktop = {
  available: () => inTauri,
  /* 窗口是否被藏起来（关窗收进托盘 / 最小化）。用来决定"这条提醒谁发" */
  hidden: () => !inTauri || document.visibilityState !== "visible",
  buildList, sync, schedule, inWindow, notifyNow, autostartGet, autostartSet, testNotify,
  /* 补账（Rust 发过 → 前端记账）：main.js 靠 firedPending 先让位，靠 reminders:synced 再补跑 */
  mergeFired, syncFired, firedPending,
};
})();

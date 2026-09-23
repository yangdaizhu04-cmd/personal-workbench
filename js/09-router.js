/* 09-router.js —— hash 路由 + 导航（侧栏/底栏/移动抽屉） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

const routes = {};   // id -> module
const groups = [
  {id: "today",   label: "今日", items: ["today"]},
  {id: "plan",    label: "计划", items: ["todos", "calendar", "goals", "countdown", "wishes"]},
  {id: "record",  label: "记录", items: ["habits", "journal", "mood", "notes", "ledger", "media", "health", "skills"]},
  {id: "tool",    label: "工具", items: ["pomodoro", "links", "fun"]},
  {id: "content", label: "内容", items: ["podcasts", "books"]},
  {id: "review",  label: "回顾", items: ["stats"]},
  {id: "bottom",  label: "",    items: ["trash", "settings"]},
];
const current = {id: "today"};
/* 上次渲染的路由键（id|param）：用来区分「切页」与「同一页的数据更新」 */
let lastKey = null;

function register(mod){
  routes[mod.id] = mod;
}
WB.registerModule = register; // 模块文件统一调用 WB.registerModule
function getRoute(id){ return routes[id]; }
function allRoutes(){ return routes; }
function groupsAll(){ return groups; }

function parseHash(){
  const h = location.hash.replace(/^#\/?/, "");
  const [id, param] = h.split("/");
  return {id: id || "today", param: param ? decodeURIComponent(param) : ""};
}

function nav(){
  return parseHash().id;
}

/* 当前视图应显示的标签页标题。抽出来是为了让番茄结束的标题闪烁能正确还原 ——
   原先 pomodoro.js 存的是「模块加载那一刻」的标题快照，闪完会把页名丢掉（踩坑 #057） */
function docTitle(){
  const mod = routes[current.id] || {};
  return (mod.title ? mod.title + " · " : "") + "个人工作台 · 晨雾奶油";
}

function render(){
  const {id, param} = parseHash();
  const mod = routes[id] || routes["today"];
  current.id = mod.id;
  current.param = param;
  /* 重复任务物化：原先只挂在待办页的 render 里，跨天直接落在今日页/日历时
     当天的重复实例根本不生成（必须先进一次待办页才行）。提到路由层 = 所有页都对齐 */
  if(WB.todos && WB.todos.materializeRepeats) WB.todos.materializeRepeats();

  // 视图
  const view = WB.$("#view");
  /* 同一页（同 id 同参数）的重渲染都是「页内数据更新」——勾一条待办、打一次卡、
     删一笔账、撤销删除。这类渲染必须保持滚动位置，也不能重放入场动画：
     以前一律 scrollTop=0 + 重放错峰，勾长列表第 15 条就会被弹回顶部。
     切页（含 journal 换日期这类同 id 不同参数）才归零 + 播动画 */
  const key = mod.id + "|" + param;
  const samePage = lastKey === key;
  const keepScroll = samePage ? view.scrollTop : 0;
  view.innerHTML = "";
  const inner = el("div", {class: "view-inner"});
  view.appendChild(inner);
  try{
    mod.render(inner, param);
  }catch(e){
    console.error("[router] render", mod.id, e);
    inner.appendChild(WB.ui.emptyState("cloud", "这个模块打了个盹", "渲染出错了：" + esc(e.message)));
  }
  // 顶栏
  WB.$("#page-title").textContent = mod.title || mod.id;
  const sub = WB.$("#page-sub");
  if(mod.sub) sub.textContent = typeof mod.sub === "function" ? mod.sub() : mod.sub;
  else sub.textContent = "";
  document.title = docTitle();

  // 导航高亮
  WB.$$("#side-nav .nav-item, #bottombar .bb-item").forEach(n => {
    n.classList.toggle("active", n.dataset.route === mod.id);
  });
  // 转场动画：冷却闸门只锁「动画」，不锁渲染本身。
  // 若把 lock 卡在 render 入口，快速切页要么丢渲染（hash 与视图不一致）、要么内容延迟出现；
  // 锁在动画上则在冷却期内直接以终态呈现，既不掉内容也不叠帧（2.1）
  if(!samePage && WB.ui.lock("route", 400)){
    if(WB.gsapReady && WB.gsapReady() && !WB.ui.motionOff()){
      gsap.fromTo(inner, {opacity: 0, y: 10}, {opacity: 1, y: 0, duration: .38, ease: "power2.out", clearProps: "all"});
    }else{
      inner.classList.add("fresh");
    }
    // 注意：这里不要再对 inner 做 staggerIn。列表型模块的错峰统一由
    // main.js 的 animateCards 负责（有 .card 走 GSAP，没有才走 CSS 错峰），
    // 两处同时上会让同一批节点的 opacity/transform 被两套动画争抢。
  }
  view.scrollTop = keepScroll;
  lastKey = key;
  // 第二参告诉订阅者这是不是「同页更新」：main.js 据此跳过整页卡片入场动画
  WB.bus.emit("route:changed", mod.id, {samePage});
}

function go(id, param){
  const h = "#/" + id + (param ? "/" + encodeURIComponent(param) : "");
  if(location.hash === h) render();
  else location.hash = h;
}

/* ---------- 导航渲染 ---------- */
function buildNav(){
  const sideNav = WB.$("#side-nav");
  sideNav.innerHTML = "";
  groups.forEach(g => {
    if(g.label) sideNav.appendChild(el("div", {class: "nav-group", text: g.label}));
    g.items.forEach(id => {
      const m = routes[id];
      if(!m) return;
      sideNav.appendChild(el("button", {
        class: "nav-item", dataset: {route: id},
        html: icon(m.icon || "circle", 19) + "<span>" + (m.title || id) + "</span>",
        onclick: () => go(id),
      }));
    });
  });
  WB.$(".side-foot [data-route]").addEventListener("click", () => go("settings"));

  // 移动端底栏：今日 + 4 个分组入口
  const bb = WB.$("#bottombar");
  bb.innerHTML = "";
  const tabs = [
    {id: "today", label: "今日", icon: "home"},
    {id: "plan", label: "计划", icon: "calendar"},
    {id: "record", label: "记录", icon: "edit"},
    {id: "tool", label: "工具", icon: "timer"},
    {id: "more", label: "更多", icon: "grid"},
  ];
  tabs.forEach(t => {
    bb.appendChild(el("button", {
      class: "bb-item" + (t.id === "today" ? "" : ""),
      dataset: {route: t.id},
      html: icon(t.icon, 21) + "<span>" + t.label + "</span>",
      onclick: () => {
        if(t.id === "today"){ go("today"); return; }
        if(t.id === "more"){ openSheet(["trash", "settings", "stats", "podcasts", "books", "media", "health", "skills", "fun", "pomodoro"]); return; }
        openSheet(groups.find(g => g.id === t.id).items);
      },
    }));
  });
}
let sheetPhase = "closed";   // closed | open | leaving
let sheetToken = 0;
function sheetOpen(){ return sheetPhase === "open"; }
/* 抽屉开合时汉堡 ↔ 叉号交叉变形（2.2） */
function menuBtnSync(open){
  const btn = WB.$("#btn-menu");
  if(btn && WB.ui.swapIcon) WB.ui.swapIcon(btn, "menu", "close", open);
}

function openSheet(ids){
  const root = WB.$("#sheet-root");
  sheetPhase = "open";
  sheetToken++;
  root.hidden = false;
  root.innerHTML = "";
  const sheet = el("div", {class: "sheet"});
  /* 遮罩层压在内容层之上，移动端顶栏不可达——抽屉必须自带显式关闭入口（4.1） */
  sheet.appendChild(el("div", {class: "sheet-head"},
    el("div", {class: "sheet-grip"}),
    el("button", {class: "icon-btn", html: icon("close", 18), "aria-label": "关闭抽屉",
      onclick: closeSheet})));
  ids.forEach(id => {
    const m = routes[id];
    if(!m) return;
    sheet.appendChild(el("button", {
      class: "nav-item",
      html: icon(m.icon || "circle", 19) + "<span>" + (m.title || id) + "</span>",
      onclick: () => { closeSheet(); go(id); },
    }));
  });
  const scrim = el("div", {class: "sheet-scrim", onclick: closeSheet});
  root.appendChild(scrim);
  root.appendChild(sheet);
  if(WB.ui.syncScrim) WB.ui.syncScrim();
  menuBtnSync(true);
  if(WB.ui.staggerIn) WB.ui.staggerIn(sheet, 40, 60);
}
function closeSheet(){
  const root = WB.$("#sheet-root");
  if(sheetPhase === "closed") return;
  sheetPhase = "leaving";
  menuBtnSync(false);
  const tk = ++sheetToken;
  const body = root.querySelector(".sheet");
  const scrim = root.querySelector(".sheet-scrim");
  const done = () => {
    if(tk !== sheetToken) return;       // 期间又开了新抽屉，别把新面板清掉
    sheetPhase = "closed";
    root.hidden = true;
    root.innerHTML = "";
    if(WB.ui.syncScrim) WB.ui.syncScrim();
  };
  if(!body || WB.ui.motionOff()){ done(); return; }
  body.classList.add("leaving");
  if(scrim) scrim.classList.add("leaving");
  setTimeout(done, 220);
}

/* 菜单按钮（移动端） */
function initChrome(){
  buildNav();
  menuBtnSync(false);
  WB.$("#btn-menu").addEventListener("click", () => {
    if(sheetOpen()){ closeSheet(); return; }
    const ids = [];
    groups.forEach(g => g.items.forEach(id => ids.push(id)));
    ids.push("trash", "settings");
    openSheet(ids);
  });
  WB.$("#btn-cmdk").addEventListener("click", () => {
    if(WB.commands && WB.commands.open) WB.commands.open();
  });
  addEventListener("hashchange", render);
}

function init(){
  initChrome();
  if(!location.hash) location.hash = "#/today";
  render();
}

/* ---------- 脏数据推送：数据变了就重绘当前视图 ----------
   结构性修法（踩坑 #057）：以前每个调用点都得自己记得 render，漏一处就留下过期 DOM
   （沉浸层里暂停番茄钟后退出、弹窗里改完用 × 关闭，都是这么过期的）。
   现在低频的状态变更统一广播 view:dirty，由这里兜住；高频计时走各自订阅的 pomo:tick，
   不会经由这条路把页面按秒重建 */
WB.bus.on("view:dirty", () => render());

/* ---------- 跨标签页：外部改了数据 ----------
   能刷就刷，不能刷就先记着 —— 弹窗开着、或正把光标放在输入框里打字时刷新，
   等于把用户正在填的东西连根拔掉。挂起的会在「弹窗关闭」或「页面重新可见」时补一次 */
let stalePending = false;
function busyEditing(){
  const a = document.activeElement;
  if(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return true;
  return !!(WB.modalOpen && WB.modalOpen());
}
function flushExternal(){
  if(!stalePending || busyEditing()) return;
  stalePending = false;
  render();
  /* 另一页开始/继续/清空了番茄，本页心跳要跟上（状态是时间戳制，不会跑偏） */
  if(WB.pomodoro && WB.pomodoro.syncTicker) WB.pomodoro.syncTicker();
}
WB.bus.on("store:external", () => { stalePending = true; flushExternal(); });
addEventListener("visibilitychange", () => { if(!document.hidden) flushExternal(); });

/* 弹窗关闭后补一次：弹窗内部改数据只重绘弹窗自己，背后的卡片会留着旧值
   （技能里程碑计数、待办子任务 n/m 都是这样过期的）—— 顺带处理被挂起的跨标签页变更 */
WB.bus.on("modal:closed", () => { render(); flushExternal(); });

WB.router = {register, getRoute, allRoutes, groups, buildNav, nav, render, go, init, current,
  docTitle, openSheet, closeSheet, sheetOpen};
})();

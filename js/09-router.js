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

function render(){
  const {id, param} = parseHash();
  const mod = routes[id] || routes["today"];
  current.id = mod.id;
  current.param = param;

  // 视图
  const view = WB.$("#view");
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
  document.title = (mod.title ? mod.title + " · " : "") + "个人工作台 · 晨雾奶油";

  // 导航高亮
  WB.$$("#side-nav .nav-item, #bottombar .bb-item").forEach(n => {
    n.classList.toggle("active", n.dataset.route === mod.id);
  });
  // 转场动画
  if(WB.gsapReady && WB.gsapReady() && !WB.ui.motionOff()){
    gsap.fromTo(inner, {opacity: 0, y: 10}, {opacity: 1, y: 0, duration: .38, ease: "power2.out", clearProps: "all"});
  }
  view.scrollTop = 0;
  WB.bus.emit("route:changed", mod.id);
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
function openSheet(ids){
  const root = WB.$("#sheet-root");
  root.hidden = false;
  root.innerHTML = "";
  const sheet = el("div", {class: "sheet"});
  sheet.appendChild(el("div", {class: "center", style: {width: "44px", height: "4px", borderRadius: "4px", background: "var(--card-border)", margin: "0 auto 8px"}}));
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
}
function closeSheet(){
  const root = WB.$("#sheet-root");
  root.hidden = true;
  root.innerHTML = "";
}

/* 菜单按钮（移动端） */
function initChrome(){
  buildNav();
  WB.$("#btn-menu").innerHTML = icon("menu", 19);
  WB.$("#btn-menu").addEventListener("click", () => {
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

WB.router = {register, getRoute, allRoutes, groups, buildNav, nav, render, go, init, current, openSheet, closeSheet};
})();

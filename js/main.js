/* main.js —— 启动：入场雾开、快捷键、提醒调度、仪式触发 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const gsapReady = () => typeof gsap !== "undefined";

/* ---------- 卡片依次升起（入场/切页共用） ---------- */
function animateCards(container){
  if(!gsapReady() || WB.ui.motionOff()) return;
  const cards = container.querySelectorAll(".card");
  if(cards.length){
    gsap.fromTo(cards,
      {opacity: 0, y: 18},
      {opacity: 1, y: 0, duration: .55, ease: "power2.out", stagger: .055, clearProps: "opacity,transform"});
    return;
  }
  // 没有卡片的列表型模块：交给 CSS 错峰（2.4 的第 4 个挂载点）。
  // 不能和上面的 GSAP 卡片的 opacity/y 同时作用于同一批节点，所以二选一。
  if(WB.ui.staggerIn) WB.ui.staggerIn(container);
}

/* ---------- 欢迎入场：雾气晕开 → 标题浮现 → 移除 ---------- */
function veilOut(){
  const veil = document.getElementById("veil");
  if(!veil) return;
  const done = () => veil.remove();
  if(!gsapReady() || WB.ui.motionOff()){ done(); return; }
  const tl = gsap.timeline({onComplete: done});
  tl.to(".veil-inner", {opacity: 1, y: 0, duration: .8, ease: "power2.out"})
    .to(".veil-inner", {opacity: 0, y: -8, duration: .5, ease: "power2.in"}, "+=1.1")
    .to(veil, {opacity: 0, duration: .7, ease: "power2.inOut"}, "-=.15");
  setTimeout(done, 4000); // 兜底
}

/* ---------- 键盘快捷键 ---------- */
function isTyping(e){
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
function initShortcuts(){
  addEventListener("keydown", e => {
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"){
      e.preventDefault();
      if(WB.commands && WB.commands.open) WB.commands.open();
      return;
    }
    /* Esc 必须在 isTyping 之前处理：弹窗与命令面板都会自动把焦点放进输入框，
       若先因"正在输入"而 return，输入状态下按 Esc 完全关不掉浮层 ——
       而设置页的快捷键表里明确写着「Esc 关闭弹窗/面板」（踩坑 #064）。
       优先级：浮层（含确认框）→ 沉浸专注 */
    if(e.key === "Escape"){
      if(WB.modalOpen && WB.modalOpen()){ e.preventDefault(); WB.closeTopModal(); return; }
      if(WB.immersive && WB.immersive.isActive()){ e.preventDefault(); WB.immersive.exit(); return; }
      return;
    }
    if(isTyping(e)) return;
    /* 沉浸专注：F 进退、空格暂停/继续（沉浸里空格不再是环境音开关）、
       ←/→ 换场景、M 环境音开关、P 与空格同效 */
    if(WB.immersive && WB.immersive.isActive()){
      if(e.key === "f" || e.key === "F"){ e.preventDefault(); WB.immersive.exit(); return; }
      if(e.key === " "){ e.preventDefault(); WB.immersive.toggleRun(); return; }
      /* ←/→ 不防连发：按住快速翻场景是想要的 */
      if(e.key === "ArrowRight"){ e.preventDefault(); if(WB.immersive.step) WB.immersive.step(1); return; }
      if(e.key === "ArrowLeft"){ e.preventDefault(); if(WB.immersive.step) WB.immersive.step(-1); return; }
      /* M/P 必须防连发：按住不放会让声音与计时来回抖动 */
      if(e.repeat) return;
      if(e.key === "m" || e.key === "M"){ e.preventDefault(); if(WB.immersive.toggleSound) WB.immersive.toggleSound(); return; }
      if(e.key === "p" || e.key === "P"){ e.preventDefault(); WB.immersive.toggleRun(); return; }
      return;
    }
    if(WB.modalOpen && WB.modalOpen()) return;   // 浮层开着：除上面的 Esc 外不再接管任何键
    switch(e.key){
      case "n": case "N": WB.router.go("notes"); if(WB.notes && WB.notes.quickAdd) WB.notes.quickAdd(); break;
      case "t": case "T": WB.router.go("todos"); if(WB.todos && WB.todos.quickAdd) WB.todos.quickAdd(); break;
      case "d": case "D": WB.theme.toggleTheme(); break;
      case "f": case "F": if(WB.immersive) WB.immersive.toggle(); break;
      case " ":
        /* 焦点在按钮/链接上时，空格的本职是"激活这个元素"——让给浏览器。
           以前一律 preventDefault 切环境音，键盘用户 Tab 到「保存」按空格毫无反应还弹出提示。
           想让空格管环境音，先点一下页面空白处，让焦点离开按钮 */
        if(/^(BUTTON|A|SUMMARY)$/.test((e.target && e.target.tagName) || "")) return;
        if(WB.pomodoro && WB.pomodoro.toggleSound){ e.preventDefault(); WB.pomodoro.toggleSound(); }
        break;
      /* M 与空格同义（全站环境音开关）；P = 番茄钟暂停/继续（沉浸外也管用）。
         两者都要防连发，否则按住不放会来回抖动 */
      case "m": case "M":
        if(!e.repeat && WB.pomodoro && WB.pomodoro.toggleSound){ e.preventDefault(); WB.pomodoro.toggleSound(); }
        break;
      case "p": case "P":
        if(!e.repeat && WB.pomodoro && WB.pomodoro.toggleRun){ e.preventDefault(); WB.pomodoro.toggleRun(); }
        break;
    }
  });
}

/* ---------- 时刻提醒调度 ---------- */
function checkReminders(){
  const today = WB.bizDate();
  const todos = WB.store.get("todos", []).filter(t =>
    !t.done && t.date === today && t.time);
  const firedKey = "firedReminders:" + today;
  const fired = new Set(WB.store.get(firedKey, []));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const settings = WB.theme.all();
  let changed = false;
  for(const t of todos){
    const [h, m] = t.time.split(":").map(Number);
    const target = h * 60 + m;
    const ahead = t.remindAhead ? {"0":0,"5":5,"10":10,"30":30}[t.remindAhead] ?? 0 : 0;
    if(nowMin >= target - ahead && nowMin <= target + 30 && !fired.has(t.id)){
      fired.add(t.id); changed = true;
      const when = ahead ? "还有 " + ahead + " 分钟" : "现在";
      const shown = WB.notify("⏰ 待办提醒", when + "：" + t.title, () => WB.router.go("todos"));
      /* 页内提示有独立开关：以前借用「全屏提示动画」(pomoFlash)，
         关掉番茄动画的人会连带失去所有待办提醒，且界面上看不出为什么 */
      if(!shown && settings.remindToast) WB.ui.toast("⏰ " + when + "：" + t.title, "warn");
    }
  }
  if(changed) WB.store.set(firedKey, Array.from(fired));
}

/* ---------- 跨业务日换日 ----------
   业务日以凌晨 4 点为界（WB.bizDate）。开着过夜时没有任何定时器会重新渲染，
   早上回来「今日」还停在昨天：待办不刷新、心情与三大件会写进昨天那一格 */
let lastBizDay = null;
function checkDayRollover(){
  const d = WB.bizDate();
  if(lastBizDay === null){ lastBizDay = d; return; }
  if(d === lastBizDay) return;
  if(WB.modalOpen && WB.modalOpen()) return;   // 有浮层开着先不打断，等下一轮
  lastBizDay = d;
  WB.router.render();
  WB.ui.toast("新的一天开始了 ✦");
}

/* ---------- modal 栈（供 Esc 关闭） ---------- */
(function(){
  const stack = [];
  const origModal = WB.ui.modal;
  WB.ui.modal = function(opts){
    const m = origModal(opts);
    stack.push(m);
    const origClose = m.close;
    m.close = function(){ const i = stack.indexOf(m); if(i >= 0) stack.splice(i, 1); origClose.apply(m, arguments); };
    return m;
  };
  /* 判断「有浮层」一律走各面板自己的 phase 状态，不要看 DOM 是否隐藏：
     退场动画期间 DOM 还在，但逻辑上已经关掉了（踩坑 #028） */
  const cmdkOpen = () => !!(WB.commands && WB.commands.isOpen && WB.commands.isOpen());
  const sheetOpen = () => !!(WB.router && WB.router.sheetOpen && WB.router.sheetOpen());
  WB.modalOpen = () => stack.length > 0 || cmdkOpen() || sheetOpen();
  WB.closeTopModal = () => {
    if(stack.length) stack[stack.length - 1].close();
    else if(sheetOpen()) WB.router.closeSheet();
    else if(cmdkOpen()) WB.commands.close();
    else if(WB.commands && WB.commands.close) WB.commands.close();
  };
})();

/* ---------- 启动 ---------- */
function boot(){
  WB.theme.init();
  if(WB.ambience && WB.ambience.init) WB.ambience.init();   // 引擎没开时 init 直接返回，零成本
  if(WB.scenes && WB.scenes.init) WB.scenes.init();
  WB.iconHydrate(document);
  WB.router.init();
  initShortcuts();
  veilOut();
  setTimeout(() => animateCards(WB.$("#view")), 300);
  setInterval(() => { checkReminders(); checkDayRollover(); }, 30000);
  setTimeout(checkReminders, 4000);
  WB.ensureNotifyPermission();

  // 周日（及以后补）自动生成本周周报
  if(WB.stats && WB.stats.ensureWeekly) WB.stats.ensureWeekly();

  // 联网状态指示（云端版有效）
  const syncBtn = WB.$("#btn-sync-state");
  const updateNet = () => {
    if(WB.net.isFile){ syncBtn.hidden = true; return; }
    syncBtn.hidden = false;
    syncBtn.textContent = WB.net.online ? "已联网" : "离线模式";
  };
  updateNet();
  WB.bus.on("net:online", updateNet);
  WB.bus.on("net:offline", updateNet);

  // 晨间仪式：当天首次打开
  const today = WB.bizDate();
  if(WB.store.get("lastOpenDay") !== today){
    WB.store.set("lastOpenDay", today);
    if(WB.rituals && WB.rituals.maybeMorning) setTimeout(() => WB.rituals.maybeMorning(), 1800);
  }
  // 每日数据快照 + 备份提醒（放启动尾部，不抢首屏）
  if(WB.snapshots && WB.snapshots.maybeDaily) setTimeout(() => WB.snapshots.maybeDaily(), 2600);
  WB.bus.on("route:changed", (id, info) => {
    if(info && info.samePage) return;   // 同页数据更新：别把整页卡片重放一遍
    setTimeout(() => animateCards(WB.$("#view")), 60);
  });
}

if(document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();

WB.gsapReady = gsapReady;
WB.animateCards = animateCards;
WB.checkDayRollover = checkDayRollover;
})();

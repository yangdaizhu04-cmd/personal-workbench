/* main.js —— 启动：入场雾开、快捷键、提醒调度、仪式触发 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const gsapReady = () => typeof gsap !== "undefined";

/* ---------- 卡片依次升起（入场/切页共用） ---------- */
function animateCards(container){
  if(!gsapReady() || WB.ui.motionOff()) return;
  const cards = container.querySelectorAll(".card");
  if(!cards.length) return;
  gsap.fromTo(cards,
    {opacity: 0, y: 18},
    {opacity: 1, y: 0, duration: .55, ease: "power2.out", stagger: .055, clearProps: "opacity,transform"});
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
    if(isTyping(e)) return;
    if(WB.modalOpen && WB.modalOpen()){ // 弹窗内只留 Esc
      if(e.key === "Escape") WB.closeTopModal();
      return;
    }
    switch(e.key){
      case "Escape":
        if(WB.closeTopModal) WB.closeTopModal();
        else if(WB.commands && WB.commands.close) WB.commands.close();
        break;
      case "n": case "N": go("notes"); if(WB.notes && WB.notes.quickAdd) WB.notes.quickAdd(); break;
      case "t": case "T": go("todos"); if(WB.todos && WB.todos.quickAdd) WB.todos.quickAdd(); break;
      case "d": case "D": WB.theme.toggleTheme(); break;
      case " ":
        if(WB.pomodoro && WB.pomodoro.toggleSound){ e.preventDefault(); WB.pomodoro.toggleSound(); }
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
      if(!shown && settings.pomoFlash !== false) WB.ui.toast("⏰ " + when + "：" + t.title, "warn");
    }
  }
  if(changed) WB.store.set(firedKey, Array.from(fired));
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
  WB.modalOpen = () => stack.length > 0 || !WB.$("#cmdk-root").hidden;
  WB.closeTopModal = () => {
    if(stack.length) stack[stack.length - 1].close();
    else if(WB.commands && WB.commands.close) WB.commands.close();
  };
})();

/* ---------- 启动 ---------- */
function boot(){
  WB.theme.init();
  WB.iconHydrate(document);
  WB.router.init();
  initShortcuts();
  veilOut();
  setTimeout(() => animateCards(WB.$("#view")), 300);
  setInterval(checkReminders, 30000);
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
  WB.bus.on("route:changed", () => setTimeout(() => animateCards(WB.$("#view")), 60));
}

if(document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();

WB.gsapReady = gsapReady;
WB.animateCards = animateCards;
})();

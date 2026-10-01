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
  /* 桌面版把窗口收进托盘/最小化之后，系统通知交给 Rust 的后台线程发（js/18-desktop.js）：
     这里直接让位，否则同一条提醒会被前后端各响一次 */
  if(WB.desktop && WB.desktop.available()){
    if(WB.desktop.hidden()) return;
    /* 还有一件事：Rust 在隐藏期间发过的那几条，前端的记账里没有（那张表只活在它那个进程里）。
       窗口刚回到可见的这几毫秒正在补账（js/18-desktop.js 的 mergeFired）——这期间先不动，
       否则会把刚补上的那条又响一次。补完会 emit reminders:synced，那时再跑（踩坑 #091） */
    if(WB.desktop.firedPending && WB.desktop.firedPending()) return;
  }
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
    /* 提前量与"到点后多久还算数"都读 js/01-utils.js 那一份（18-desktop.js 的清单用同一份） */
    const ahead = t.remindAhead ? WB.REMIND_AHEAD[t.remindAhead] ?? 0 : 0;
    if(nowMin >= target - ahead && nowMin <= target + WB.TODO_WINDOW_MIN && !fired.has(t.id)){
      const when = ahead ? "还有 " + ahead + " 分钟" : "现在";
      const shown = WB.notify("⏰ 待办提醒", when + "：" + t.title, () => WB.router.go("todos"));
      /* 页内提示有独立开关：以前借用「全屏提示动画」(pomoFlash)，
         关掉番茄动画的人会连带失去所有待办提醒，且界面上看不出为什么 */
      if(!shown && settings.remindToast) WB.ui.toast("⏰ " + when + "：" + t.title, "warn");
      /* 只有**真的显示出来了**才算提醒过。原先"尝试过就记账"，一旦那条通道是哑的
         （桌面版开着窗口时正是如此），这条待办当天再也不会提醒第二次（踩坑 #079） */
      if(shown || settings.remindToast){ fired.add(t.id); changed = true; }
    }
  }
  if(changed) WB.store.set(firedKey, Array.from(fired));
  /* 桌面版：倒数日/生日/晨间/收工也走同一份清单（待办已在上面的循环里处理过）。
     网页版不调 —— 那些提醒的时刻在网页版没有设置入口 */
  if(WB.desktop && WB.desktop.available() && WB.desktop.inWindow) WB.desktop.inWindow();
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
  /* 数据迁移最优先：theme.init 要把旧字段升级成新结构时，必须先到当前 schema（见 02-store §Schema） */
  try{ WB.store.runMigrations(); }
  catch(e){ console.error("[boot] 数据迁移失败，继续启动", e); }
  /* 各初始化段独立容错：单模块抛错记录后继续，不让整条启动链断掉
     （一个模块初始化失败 ≠ 全站不可用；若确需阻止后续，优先在段内 return 而非抛错） */
  try{ WB.theme.init(); }catch(e){ console.error("[boot] theme.init 失败", e); }
  try{ if(WB.ambience && WB.ambience.init) WB.ambience.init(); }catch(e){ console.error("[boot] ambience.init 失败", e); }
  try{ if(WB.scenes && WB.scenes.init) WB.scenes.init(); }catch(e){ console.error("[boot] scenes.init 失败", e); }
  try{ WB.iconHydrate(document); }catch(e){ console.error("[boot] iconHydrate 失败", e); }
  try{ WB.router.init(); }catch(e){ console.error("[boot] router.init 失败", e); }
  try{ initShortcuts(); }catch(e){ console.error("[boot] initShortcuts 失败", e); }
  try{ veilOut(); }catch(e){ console.error("[boot] veilOut 失败", e); }
  setTimeout(() => animateCards(WB.$("#view")), 300);
  setInterval(() => { checkReminders(); checkDayRollover(); }, 30000);
  /* 桌面版补账完成（Rust 已发的并进前端记账）→ 立刻补跑一轮：
     上面那道 firedPending 门就是为了等这一刻，不然窗口刚回到可见时会漏掉这一轮 */
  WB.bus.on("reminders:synced", () => checkReminders());
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
  // 每日数据快照 + 备份提醒：放启动尾部不抢首屏；空闲才拍（浏览器空闲就绪前不打扰交互）
  if(WB.snapshots && WB.snapshots.maybeDaily){
    const run = () => WB.snapshots.maybeDaily();
    if("requestIdleCallback" in window) requestIdleCallback(run, {timeout: 8000});
    else setTimeout(run, 2600);
  }
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

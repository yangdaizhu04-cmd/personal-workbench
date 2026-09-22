/* 06-ui.js —— 通用 UI：弹窗/吐司/确认/空状态/彩带/星光/拖拽/进度环/骨架 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
/* $$ 必须一起解构：draggable() 的 dragover/dragend 里用了 $$，
   此前漏解构 → 每次拖动都抛 "$$ is not defined"，整条拖拽重排链路静默失效 */
const { el, esc, icon, $$ } = WB;
const motionOff = () => document.documentElement.classList.contains("no-motion");

/* ---------- 冷却闸门（交互互斥） ----------
   ms 必须 ≥ 对应 CSS 动画时长，否则动画会叠加；返回 false = 冷却中，调用方直接忽略本次操作 */
const locks = new Map();
function lock(key, ms){
  if(locks.has(key)) return false;
  locks.set(key, setTimeout(() => locks.delete(key), ms));
  return true;
}

/* ---------- 图标交叉变形 ---------- */
/* 两个图标绝对叠放，靠 .icon-swap.is-b 交叉（CSS 在 main.css 的「动效原子」段） */
function swapIcon(btn, iconA, iconB, showB){
  if(!btn || !WB.icon) return;
  if(!btn.dataset.swapReady){
    btn.innerHTML = "<span>" + WB.icon(iconA) + "</span><span>" + WB.icon(iconB) + "</span>";
    btn.classList.add("icon-swap");
    btn.dataset.swapReady = "1";
    btn.__iconed = true;   // 挡住 iconHydrate 的 data-icon 补图，否则会被塞进第三个图标
  }
  btn.classList.toggle("is-b", !!showB);
}

/* ---------- 错峰入场 ----------
   延迟用 CSS 变量 --d 传，transition 本身写在 CSS 里，
   这样 html.no-motion 的 !important 熔断依然生效（不要改成内联 animation） */
function staggerTargets(scope){
  let nodes = Array.from(scope.children);
  if(nodes.length === 1 && nodes[0].children.length > 1) nodes = Array.from(nodes[0].children);
  return nodes.filter(n => !n.classList.contains("stagger-item"));
}
function staggerIn(scope, step = 50, base = 100){
  if(!scope || motionOff()) return;
  const nodes = staggerTargets(scope);
  if(nodes.length < 2) return;   // 单项做错峰只会显得迟钝
  nodes.forEach((n, i) => {
    n.classList.add("stagger-item");
    n.style.setProperty("--d", (base + i * step) + "ms");
  });
  void scope.offsetHeight;       // 先让初始态落地，再加 is-in 才有过渡
  nodes.forEach(n => n.classList.add("is-in"));
}

/* 有全屏遮罩时给 body 挂 scrim-open：让侧栏摘掉 backdrop-filter。
   减少「同时存在」的模糊层数，比给它们加 will-change 更有效（4.5） */
function syncScrim(){
  document.body.classList.toggle("scrim-open",
    !!document.querySelector(".modal-scrim, .cmdk-scrim, .sheet-scrim"));
}

/* ---------- 吐司 ----------
   第三参 action = {label, onClick} 时变成「可撤销提示」：停留更久、可点、悬停时暂停倒计时。
   只有这种吐司开 pointer-events（见 .toast.has-act），普通吐司仍整条穿透不挡点击 */
const TOAST_TTL = {plain: 2400, act: 6000, hover: 1600};
function toast(msg, type, action){
  const root = WB.$("#toast-root");
  const ic = type === "warn" ? "moon" : type === "sad" ? "heart" : "check-circle";
  const t = el("div", {class: "toast" + (action ? " has-act" : ""), html: icon(ic, 16) + "<span></span>"});
  t.querySelector("span").textContent = msg;
  let timer = null;
  const dismiss = () => {
    if(!t.isConnected) return;
    clearTimeout(timer);
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 320);
  };
  let ttl = action ? TOAST_TTL.act : TOAST_TTL.plain;
  const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, ttl); };
  if(action){
    const btn = el("button", {class: "toast-act", type: "button", text: action.label});
    btn.addEventListener("click", () => { dismiss(); action.onClick(); });
    t.appendChild(btn);
    t.addEventListener("mouseenter", () => clearTimeout(timer));   // 正在看/准备点，先别收走
    t.addEventListener("mouseleave", () => { ttl = TOAST_TTL.hover; arm(); });
  }
  root.appendChild(t);
  arm();
  return t;
}

/* 可撤销提示：items 为刚进回收站的条目（由 02-store.js 的 toTrash 统一调用） */
function undoToast(items){
  if(!items || !items.length) return;
  const n = items.length;
  toast(n > 1 ? "已移入回收站（" + n + " 件）" : "已移入回收站", null, {
    label: "撤销",
    onClick: () => {
      WB.restoreTrash(items);
      WB.ui.toast("已还原");
      if(WB.router && WB.router.render) WB.router.render();
    },
  });
}

/* ---------- 弹窗 ---------- */
/* 焦点陷阱：Tab / Shift+Tab 在弹窗内循环。没有它，键盘用户 Tab 会跑到遮罩背后的
   侧栏导航项上；日志这类没有 autofocus 的弹窗，要从文档开头 Tab 十几次才够得到「保存」 */
function trapFocus(box, e){
  const nodes = Array.from(box.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(n => n.offsetWidth || n.offsetHeight || n === document.activeElement);
  if(!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
  if(e.shiftKey){
    if(active === first || !box.contains(active)){ e.preventDefault(); last.focus(); }
  }else if(active === last || !box.contains(active)){ e.preventDefault(); first.focus(); }
}
function modal({title, icon: ic, content, actions, wide, onClose}){
  const root = WB.$("#modal-root");
  const body = el("div", {class: "modal-body"});
  const box = el("div", {class: "modal" + (wide ? " wide" : ""), role: "dialog", tabindex: "-1"});  // tabindex 供初始焦点兜底
  /* 关闭统一走 m.close：main.js 的 modal 栈包装只替换返回对象上的 close，
     × 按钮/遮罩若直调内部 close 会漏弹栈，modalOpen 恒真导致快捷键被拦（踩坑 #028） */
  const m = {el: box, body, close: null};
  let closing = false;
  function close(ok){
    if(closing) return;               // 防抖：× 按钮与 onClose 可能在同一轮里各调一次
    closing = true;
    // 退场动画：时长与进场对齐但短约 30%。事件与出栈必须在「退场开始时」就完成，
    // 等 setTimeout 会让 200ms 窗口期内快捷键仍被弹窗栈拦住（踩坑 #028）
    // syncScrim 必须跟在「真正移除」之后：退场期间遮罩还在 DOM 里，
    // 提前调用会让 body.scrim-open 永远摘不掉，侧栏白丢一层 backdrop-filter
    if(motionOff() || !scrim.isConnected){
      scrim.remove();
      syncScrim();
    }else{
      scrim.classList.add("leaving");
      box.classList.add("leaving");
      setTimeout(() => { scrim.remove(); syncScrim(); }, 200);
    }
    WB.bus.emit("modal:closed");
    if(onClose) onClose(ok);
  }
  m.close = close;
  if(title || ic){
    box.appendChild(el("div", {class: "modal-head"},
      ic ? el("span", {html: icon(ic, 20), style: {color: "var(--accent)", display: "flex"}}) : null,
      el("h3", {text: title}),
      el("button", {class: "icon-btn", html: icon("close", 18), "aria-label": "关闭",
        onclick: () => m.close()})));
  }
  box.appendChild(body);
  const foot = el("div", {class: "modal-foot"});
  box.appendChild(foot); // 始终挂载：晨间/收工仪式等无 actions 调用方需要自行填充按钮（空时由 CSS 隐藏）

  const scrim = el("div", {class: "modal-scrim"}, box);
  (actions || []).forEach(a => {
    foot.appendChild(el("button", {
      class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "") + (a.sm ? " sm" : ""),
      text: a.label, onclick: () => {
        const keep = a.onClick ? a.onClick(box, body) : false;
        if(!keep && a.onClick) return;
        if(!a.onClick || !keep) m.close(true);
      },
    }));
  });
  if(typeof content === "string") body.innerHTML = content;
  else if(content) body.appendChild(content);
  scrim.addEventListener("mousedown", e => { if(e.target === scrim) m.close(); });
  scrim.addEventListener("keydown", e => { if(e.key === "Tab") trapFocus(box, e); });
  root.appendChild(scrim);
  syncScrim();
  staggerIn(body);   // 多分区表单依次浮现；单项弹窗自动跳过（2.4）
  /* 初始焦点兜底：模块自己 focus 输入框的（60ms）优先；没指定焦点的（如日志编辑器）
     落在弹窗容器上，这样 Tab 从弹窗内开始，键盘也能走完整个表单 */
  setTimeout(() => { if(!box.contains(document.activeElement)) box.focus(); }, 90);
  return m;
}

function confirmBox(msg, {title = "确认一下", okLabel = "确认", danger} = {}){
  return new Promise(resolve => {
    /* 两处修正（2026-09-21，沉浸专注层回归时发现）：
       ① 带 onClick 的动作 modal() 不会自动关（由调用方负责，见 todos.js 的「不自动关」约定），
          而这两个按钮原来既不自己关也不返回 true → 点完按钮全屏遮罩永久留在 DOM 里挡住整页，
          连 Esc 都关不掉。这里补上 m.close()。
       ② 改走 WB.ui.modal（main.js 包装过的带栈版本）：入栈后 Esc / modalOpen() 才认得它，
          否则沉浸专注层里弹的确认框会被 Esc 直接穿过（先退沉浸、弹窗还挂着）。
          resolve 先到者为准：close() 会触发 onClose→resolve(false)，不覆盖已 resolve 的结果 */
    const open = (WB.ui && WB.ui.modal) ? WB.ui.modal : modal;
    const m = open({
      title,
      content: '<p style="line-height:1.8">' + msg + "</p>",
      actions: [
        {label: "再想想", onClick: () => { resolve(false); m.close(); return true; }},
        {label: okLabel, primary: !danger, danger, onClick: () => { resolve(true); m.close(); return true; }},
      ],
      onClose: () => resolve(false),
    });
  });
}

/* ---------- 空状态 ---------- */
function emptyState(ic, title, hint, action){
  const box = el("div", {class: "empty"},
    el("div", {class: "breathe", html: icon(ic, 52)}),
    el("div", {class: "e-title", text: title}),
    hint ? el("div", {class: "e-hint", html: hint}) : null,
    action || null);
  return box;
}

/* ---------- 彩带 & 星光 ---------- */
const fx = WB.$("#fx-canvas");
const fctx = fx.getContext("2d");
let fxParts = [], fxRunning = false;
function fxResize(){ fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio; }
addEventListener("resize", fxResize); fxResize();

const CONFETTI_COLORS = ["#a9c6d8", "#b9aade", "#eedcb2", "#e8b4a8", "#9ec8b4", "#f3ede1"];
function confetti(x, y, n = 60){
  if(motionOff()) return;
  x *= devicePixelRatio; y *= devicePixelRatio;
  for(let i = 0; i < n; i++){
    const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 5) * devicePixelRatio;
    fxParts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2 * devicePixelRatio,
      g: 0.12 * devicePixelRatio, life: 60 + Math.random() * 40, t: 0,
      w: (3 + Math.random() * 4) * devicePixelRatio, h: (5 + Math.random() * 6) * devicePixelRatio,
      rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    });
  }
  if(!fxRunning){ fxRunning = true; requestAnimationFrame(fxTick); }
}
function starBurst(x, y, n = 12){
  if(motionOff()) return;
  x *= devicePixelRatio; y *= devicePixelRatio;
  for(let i = 0; i < n; i++){
    const a = (i / n) * Math.PI * 2 + Math.random() * .4, sp = (1.5 + Math.random() * 2.5) * devicePixelRatio;
    fxParts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: .02 * devicePixelRatio,
      life: 34 + Math.random() * 18, t: 0, star: true,
      size: (2 + Math.random() * 2.5) * devicePixelRatio,
      color: Math.random() < .5 ? "#e8cf8f" : "#b9aade",
    });
  }
  if(!fxRunning){ fxRunning = true; requestAnimationFrame(fxTick); }
}
function fxTick(){
  fctx.clearRect(0, 0, fx.width, fx.height);
  fxParts = fxParts.filter(p => p.t < p.life);
  for(const p of fxParts){
    p.t++; p.x += p.vx; p.y += p.vy; p.vy += p.g; p.rot += p.vr || 0;
    /* life 是小数（34~52），最后一帧 p.t 会略超 life：k 若为负，
       arc() 抛 IndexSizeError 会中断整个 tick —— rAF 不再续排，fxRunning 永久为 true，
       彩带/星光从此再也不画（踩坑 #063）。夹到 0 即根治 */
    const k = Math.max(0, 1 - p.t / p.life);
    fctx.globalAlpha = Math.max(0, k);
    fctx.fillStyle = p.color;
    if(p.star){
      fctx.beginPath();
      fctx.arc(p.x, p.y, p.size * k, 0, 7); fctx.fill();
    }else{
      fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
      fctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * k); fctx.restore();
    }
  }
  fctx.globalAlpha = 1;
  if(fxParts.length){ requestAnimationFrame(fxTick); }
  else { fxRunning = false; fctx.clearRect(0, 0, fx.width, fx.height); }
}
/* 页面内彩带（顶部撒落） */
function celebrate({big} = {}){
  if(motionOff()) return;
  confetti(innerWidth * .5, innerHeight * .28, big ? 130 : 60);
  if(big) setTimeout(() => confetti(innerWidth * .25, innerHeight * .2, 50), 200);
  if(big) setTimeout(() => confetti(innerWidth * .75, innerHeight * .2, 50), 400);
}

/* ---------- 进度环 ---------- */
let ringSeq = 0;
function ring(pct, size = 44, strokeW = 4, label){
  const id = "ringGrad" + (++ringSeq);
  const r = (size - strokeW) / 2, c = 2 * Math.PI * r;
  pct = WB.clamp(pct, 0, 100);
  const wrap = el("div", {class: "ring", style: {width: size + "px", height: size + "px"}});
  wrap.innerHTML =
    '<svg width="' + size + '" height="' + size + '">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" class="g-a"/><stop offset="1" class="g-b"/></linearGradient></defs>' +
    '<circle class="ring-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + strokeW + '"/>' +
    '<circle class="ring-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + strokeW +
    '" stroke="url(#' + id + ')" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '"/></svg>' +
    '<span class="ring-label">' + (label != null ? label : (pct ? pct + "%" : "")) + "</span>";
  const fg = wrap.querySelector(".ring-fg");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fg.style.strokeDashoffset = c * (1 - pct / 100);
  }));
  // 渐变取主题色
  const ga = wrap.querySelector(".g-a"), gb = wrap.querySelector(".g-b");
  const apply = () => {
    const cs = getComputedStyle(document.documentElement);
    ga.style.stopColor = cs.getPropertyValue("--accent").trim();
    gb.style.stopColor = cs.getPropertyValue("--accent-2").trim();
  };
  apply();
  return wrap;
}

/* ---------- 拖拽排序（列表/卡片通用） ---------- */
function draggable(container, {itemSel = "[data-drag-id]", onReorder, handle = false} = {}){
  let dragEl = null;
  const sel = () => Array.from(container.querySelectorAll(itemSel));
  /* 手写 FLIP：DOM 换位前记位置 → 换位后反向位移 → 下一帧交还 CSS 过渡（2.8）
     不使用 GSAP Flip 插件，避免额外体积 */
  function flipMove(prev){
    for(const n of sel()){
      if(n === dragEl) continue;
      const before = prev.get(n);
      if(!before) continue;
      const after = n.getBoundingClientRect();
      const dx = before.left - after.left, dy = before.top - after.top;
      if(!dx && !dy) continue;
      n.style.transition = "none";                       // 先钉在旧位置
      n.style.transform = "translate(" + dx + "px," + dy + "px)";
      requestAnimationFrame(() => {
        void n.offsetWidth;                              // 样式落地后才起跑过渡
        n.classList.add("flip-anim");
        n.style.transition = "";                         // 交还 CSS
        n.style.transform = "";
        n.addEventListener("transitionend", function done(){
          n.classList.remove("flip-anim");
          n.removeEventListener("transitionend", done);
        });
      });
    }
  }
  container.addEventListener("mousedown", e => {
    if(handle && !e.target.closest("[data-drag-handle]")) return;
    const item = e.target.closest(itemSel);
    if(!item || container !== item.parentElement && !item.parentElement.contains(item)) return;
    if(e.target.closest("input,textarea,button,select,a,[data-no-drag]")) return;
    dragEl = item;
  });
  container.addEventListener("dragstart", e => {
    const item = e.target.closest && e.target.closest(itemSel);
    if(!item) return;
    dragEl = item; item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try{ e.dataTransfer.setData("text/plain", item.dataset.dragId || ""); }catch(err){}
  });
  container.addEventListener("dragend", () => {
    if(dragEl) dragEl.classList.remove("dragging");
    $$(".drop-target", container).forEach(n => n.classList.remove("drop-target"));
    dragEl = null;
  });
  container.addEventListener("dragover", e => {
    if(!dragEl) return;
    e.preventDefault();
    const target = e.target.closest(itemSel);
    $$(".drop-target", container).forEach(n => n.classList.remove("drop-target"));
    if(!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const next = before ? target : target.nextSibling;
    // 原位插入不产生位移动画，也避免无意义的 layout 读
    if(next === dragEl || next === dragEl.nextSibling){ target.classList.add("drop-target"); return; }
    const prev = motionOff() ? null : new Map(sel().map(n => [n, n.getBoundingClientRect()]));
    container.insertBefore(dragEl, next);
    if(prev) flipMove(prev);
    target.classList.add("drop-target");
  });
  container.addEventListener("drop", e => {
    e.preventDefault();
    $$(".drop-target", container).forEach(n => n.classList.remove("drop-target"));
    if(dragEl && onReorder) onReorder(Array.from(container.querySelectorAll(itemSel)).map(n => n.dataset.dragId));
  });
}
/* 给元素开启 HTML5 拖拽 */
function enableDrag(elm){ elm.setAttribute("draggable", "true"); }

/* ---------- 骨架屏 ---------- */
/* 微光动画走 .card.skeleton（CSS 里定义 @keyframes skShine）：内联 animation 会绕过 no-motion 熔断 */
function skeleton(rows = 3){
  const box = el("div");
  for(let i = 0; i < rows; i++) box.appendChild(el("div", {class: "card skeleton"}));
  return box;
}

/* ---------- 确认音（WebAudio 合成铃声） ---------- */
let audioCtx = null;
function getCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC) audioCtx = new AC();
  }
  if(audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function chime(kind = "done"){
  if(motionOff()) return;
  const ctx = getCtx(); if(!ctx) return;
  const now = ctx.currentTime;
  const notes = kind === "done" ? [523.25, 659.25, 783.99] : kind === "big" ? [523.25, 659.25, 783.99, 1046.5, 783.99] : [392, 329.63];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, now + i * .16);
    g.gain.linearRampToValueAtTime(.16, now + i * .16 + .03);
    g.gain.exponentialRampToValueAtTime(.001, now + i * .16 + .9);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * .16); o.stop(now + i * .16 + 1);
  });
}

/* ---------- 数字滚动 ---------- */
function countUp(node, to, {dur = 0.9, suffix = ""} = {}){
  if(motionOff()){ node.textContent = to + suffix; return; }
  const obj = {v: 0};
  gsap.to(obj, {v: to, duration: dur, ease: "power2.out",
    onUpdate: () => { node.textContent = Math.round(obj.v) + suffix; }});
}

Object.assign(WB.ui = {}, {
  toast, undoToast, modal, confirmBox, emptyState, confetti, starBurst, celebrate,
  ring, draggable, enableDrag, skeleton, chime, countUp, getCtx, motionOff,
  lock, swapIcon, staggerIn, syncScrim,
});
WB.draggable = draggable;
WB.enableDrag = enableDrag;
})();

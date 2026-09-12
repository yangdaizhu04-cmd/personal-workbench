/* 06-ui.js —— 通用 UI：弹窗/吐司/确认/空状态/彩带/星光/拖拽/进度环/骨架 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, esc, icon } = WB;
const motionOff = () => document.documentElement.classList.contains("no-motion");

/* ---------- 吐司 ---------- */
function toast(msg, type){
  const root = WB.$("#toast-root");
  const ic = type === "warn" ? "moon" : type === "sad" ? "heart" : "check-circle";
  const t = el("div", {class: "toast", html: icon(ic, 16) + "<span></span>"});
  t.querySelector("span").textContent = msg;
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 320);
  }, 2400);
}

/* ---------- 弹窗 ---------- */
function modal({title, icon: ic, content, actions, wide, onClose}){
  const root = WB.$("#modal-root");
  const body = el("div", {class: "modal-body"});
  const box = el("div", {class: "modal" + (wide ? " wide" : ""), role: "dialog"});
  if(title || ic){
    box.appendChild(el("div", {class: "modal-head"},
      ic ? el("span", {html: icon(ic, 20), style: {color: "var(--accent)", display: "flex"}}) : null,
      el("h3", {text: title}),
      el("button", {class: "icon-btn", html: icon("close", 18), "aria-label": "关闭",
        onclick: () => close()})));
  }
  box.appendChild(body);
  const foot = el("div", {class: "modal-foot"});
  if(actions && actions.length) box.appendChild(foot);

  const scrim = el("div", {class: "modal-scrim"}, box);
  function close(ok){
    scrim.remove();
    WB.bus.emit("modal:closed");
    if(onClose) onClose(ok);
  }
  (actions || []).forEach(a => {
    foot.appendChild(el("button", {
      class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "") + (a.sm ? " sm" : ""),
      text: a.label, onclick: () => {
        const keep = a.onClick ? a.onClick(box, body) : false;
        if(!keep && a.onClick) return;
        if(!a.onClick || !keep) close(true);
      },
    }));
  });
  if(typeof content === "string") body.innerHTML = content;
  else if(content) body.appendChild(content);
  scrim.addEventListener("mousedown", e => { if(e.target === scrim) close(); });
  root.appendChild(scrim);
  return {el: box, body, close};
}

function confirmBox(msg, {title = "确认一下", okLabel = "确认", danger} = {}){
  return new Promise(resolve => {
    const m = modal({
      title,
      content: '<p style="line-height:1.8">' + msg + "</p>",
      actions: [
        {label: "再想想", onClick: () => { resolve(false); return false; }},
        {label: okLabel, primary: !danger, danger, onClick: () => { resolve(true); return false; }},
      ],
      onClose: () => resolve(false),
    });
    // 修正：点"再想想"也会触发 onClose→resolve(false)，以先到者为准
    m.el.addEventListener("click", () => {}, {once: true});
  });
}

/* ---------- 空状态 ---------- */
function emptyState(ic, title, hint, action){
  const box = el("div", {class: "empty"},
    el("div", {html: icon(ic, 52)}),
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
    const k = 1 - p.t / p.life;
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
    if(target && target !== dragEl){
      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      container.insertBefore(dragEl, before ? target : target.nextSibling);
      target.classList.add("drop-target");
    }
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
function skeleton(rows = 3){
  const box = el("div");
  for(let i = 0; i < rows; i++){
    box.appendChild(el("div", {class: "card", style: {marginBottom: "12px", height: "64px", opacity: .55,
      background: "linear-gradient(100deg, var(--card-2) 40%, var(--card) 50%, var(--card-2) 60%)",
      backgroundSize: "200% 100%", animation: "skShine 1.4s infinite"}}));
  }
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
  toast, modal, confirmBox, emptyState, confetti, starBurst, celebrate,
  ring, draggable, enableDrag, skeleton, chime, countUp, getCtx, motionOff,
});
WB.draggable = draggable;
WB.enableDrag = enableDrag;
})();

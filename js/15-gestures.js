/* 15-gestures.js —— 移动端深度适配：左右滑动切模块 / 下拉刷新（跟手 + 回弹）
   （仅窄屏生效；桌面端无感知） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

let sx = 0, sy = 0, t0 = 0, pulling = false, pullStartY = 0;

/* 沉浸专注层打开时让位：横滑切页 / 下拉刷新都不该在沉浸里生效（改动见 js/16-immersive.js） */
function immersiveBusy(){ return !!(WB.immersive && WB.immersive.isActive()); }

/* 左右滑动：在当前分组内的模块顺序里切换 */
function groupOrderOf(id){
  const groups = WB.router.groups;
  for(const g of groups){
    const i = g.items.indexOf(id);
    if(i >= 0) return g.items;
  }
  return ["today"];
}
function swipeTo(dir){
  const cur = WB.router.nav();
  const order = groupOrderOf(cur);
  let i = order.indexOf(cur);
  if(i < 0) i = 0;
  const next = order[i + dir];
  if(next) WB.router.go(next);
}

/* ---------- 下拉刷新：跟手位移 ----------
   0.4 阻尼 + 88px 上限；跟手期间 transition:none，松手才交还 CSS（2.9）。
   与 js/main.js 的 animateCards 用 clearProps 交还 CSS 是同一思路。 */
const PULL_MAX = 88, PULL_DAMP = .4;
function pullTip(){
  let tip = document.getElementById("pull-tip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "pull-tip";
    // 呼吸效果放在内层 span：外层 #pull-tip 的 translateX(-50%) 与 .breathe 的
    // translateY/scale 都在 transform 上，同一元素会互相覆盖
    tip.innerHTML = '<span class="breathe"></span>';
    document.body.appendChild(tip);
  }
  return tip;
}
function pullTipText(tip, text){ if(tip && tip.firstChild) tip.firstChild.textContent = text; }
function pullFollow(dy){
  const view = document.getElementById("view");
  if(!view || WB.ui.motionOff()) return;
  view.style.transition = "none";
  view.style.transform = "translateY(" + Math.min(dy * PULL_DAMP, PULL_MAX) + "px)";
}
function pullRelease(){
  const view = document.getElementById("view");
  if(!view) return;
  // no-motion 下 html.no-motion * 的 !important 会熔断这条 transition，直接归位
  view.style.transition = "transform .3s var(--ease-soft)";
  view.style.transform = "";
  const clear = () => { view.style.transition = ""; view.removeEventListener("transitionend", clear); };
  view.addEventListener("transitionend", clear);
}
function pullReset(){
  pullStartY = 0; pulling = false;
  const tip = document.getElementById("pull-tip");
  if(tip) tip.remove();
}

document.addEventListener("touchstart", e => {
  if(immersiveBusy()) return;
  if(e.touches.length !== 1) return;
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  t0 = Date.now();
  pulling = false;
  const view = document.getElementById("view");
  if(view && view.scrollTop <= 0 && sy < innerHeight * .5) pullStartY = sy;
}, {passive: true});

document.addEventListener("touchmove", e => {
  if(immersiveBusy()) return;
  if(!pullStartY) return;
  const dy = e.touches[0].clientY - pullStartY;
  if(dy <= 0) return;
  pullFollow(dy);                       // 跟手：位移量始终可见，不再只是提示条变透明度
  if(dy > 24 && !pulling){
    pulling = true;
    const tip = pullTip();
    pullTipText(tip, "↓ 松手刷新");
  }
  if(pulling){
    const tip = document.getElementById("pull-tip");
    if(tip) tip.style.opacity = dy > 80 ? "1" : ".5";
  }
}, {passive: true});

document.addEventListener("touchend", e => {
  if(immersiveBusy()){ if(pullStartY){ pullRelease(); pullReset(); } return; }
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  const dt = Date.now() - t0;

  /* 下拉刷新 */
  if(pulling && dy > 70){
    const tip = document.getElementById("pull-tip");
    if(tip){
      pullTipText(tip, "✓ 已刷新");
      setTimeout(() => tip.remove(), 700);
    }
    pullRelease();          // 先让页面回弹，再重绘内容
    WB.router.render();
    pullStartY = 0; pulling = false;
    return;
  }
  if(pullStartY){
    if(pulling) pullRelease();
    pullReset();
  }

  /* 左右滑切模块：保留阈值判定式（横向跟手会与浏览器自身的横滚/返回手势抢手势） */
  if(dt < 600 && Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.8){
    const t = e.target;
    if(t.closest && t.closest("input,textarea,select,[data-no-swipe],.modal-scrim,#cmdk-root")) return;
    swipeTo(dx < 0 ? 1 : -1);
  }
}, {passive: true});

document.addEventListener("touchcancel", () => {
  if(pullStartY){ pullRelease(); pullReset(); }
}, {passive: true});
})();

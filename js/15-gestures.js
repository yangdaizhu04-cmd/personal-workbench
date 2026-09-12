/* 15-gestures.js —— 移动端深度适配：左右滑动切模块 / 下拉刷新
   （仅窄屏生效；桌面端无感知） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

let sx = 0, sy = 0, t0 = 0, pulling = false, pullStartY = 0;

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

document.addEventListener("touchstart", e => {
  if(e.touches.length !== 1) return;
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  t0 = Date.now();
  pulling = false;
  const view = document.getElementById("view");
  if(view && view.scrollTop <= 0 && sy < innerHeight * .5) pullStartY = sy;
}, {passive: true});

document.addEventListener("touchmove", e => {
  if(pullStartY){
    const dy = e.touches[0].clientY - pullStartY;
    if(dy > 24 && !pulling){
      pulling = true;
      let tip = document.getElementById("pull-tip");
      if(!tip){
        tip = document.createElement("div");
        tip.id = "pull-tip";
        tip.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99;" +
          "padding:6px 16px;border-radius:14px;background:var(--card);box-shadow:var(--shadow-s);" +
          "font-size:13px;color:var(--ink-2);transition:opacity .25s;opacity:0";
        tip.textContent = "↓ 松手刷新";
        document.body.appendChild(tip);
      }
      tip.style.opacity = dy > 80 ? "1" : ".5";
    }
  }
}, {passive: true});

document.addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - sx;
  const dy = e.changedTouches[0].clientY - sy;
  const dt = Date.now() - t0;

  /* 下拉刷新 */
  if(pulling && dy > 70){
    const tip = document.getElementById("pull-tip");
    if(tip){ tip.textContent = "✓ 已刷新"; setTimeout(() => tip.remove(), 700); }
    WB.router.render();
    pullStartY = 0; pulling = false;
    return;
  }
  const tip = document.getElementById("pull-tip");
  if(tip) tip.remove();
  pullStartY = 0; pulling = false;

  /* 左右滑切模块 */
  if(dt < 600 && Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.8){
    const t = e.target;
    if(t.closest && t.closest("input,textarea,select,[data-no-swipe],.modal-scrim,#cmdk-root")) return;
    swipeTo(dx < 0 ? 1 : -1);
  }
}, {passive: true});
})();

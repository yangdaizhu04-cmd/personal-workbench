/* modules/scenes.js —— 窗景页：三扇自包含场景窗（ThreeUI MIT 移植），iframe 懒加载 + gsap 开窗动效
   场景文件在 vendor/threeui/pages/；单文件构建版不含（构建时注入 WB_SINGLE_FILE 标记并隐藏入口） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el } = WB;

const SCENES = {
  mountains: {title: "窗外 · 山雾四季", file: "vendor/threeui/pages/landscape.html"},
  tower:     {title: "窗外 · 和塔暮色", file: "vendor/threeui/pages/japanese-tower.html"},
  study:     {title: "窗外 · 书房灯下", file: "vendor/threeui/pages/complete-shelf.html"},
};

let openKey = null;
let gen = 0;   // 每次开/关都自增：退场的兜底定时器不能把「期间重新打开」的窗景关掉

function frame(){
  return {
    viewer: document.getElementById("scene-viewer"),
    iframe: document.getElementById("scene-iframe"),
    title: document.getElementById("scene-title"),
  };
}

const motionOff = () => document.documentElement.classList.contains("no-motion");
/* 开窗 .55s / 关窗 .32s：重叠会打架，开窗整体走冷却闸门（2.1） */
const OPEN_LOCK_MS = 600;

/* 中断进行中的补间：否则开窗动画未播完就关窗，两条 tween 会各写各的 transform */
function killTweens(viewer){
  if(!window.gsap || !viewer) return;
  const target = viewer.querySelector(".scene-frame");
  if(target) gsap.killTweensOf(target);
  gsap.killTweensOf(viewer);
}

function open(key){
  const s = SCENES[key];
  if(!s) return;
  if(window.WB_SINGLE_FILE){ WB.ui.toast("单文件版不含窗景，用文件夹版（启动工作台.bat）打开"); return; }
  if(!WB.ui.lock("scene", OPEN_LOCK_MS)) return;
  const f = frame();
  if(!f.viewer || !f.iframe) return;
  gen++;
  openKey = key;
  killTweens(f.viewer);
  f.title.textContent = s.title;
  f.iframe.src = s.file; // 关闭时清空释放 GPU
  f.viewer.hidden = false;
  f.viewer.style.opacity = "";
  if(window.gsap && !motionOff()){
    gsap.fromTo(f.viewer.querySelector(".scene-frame"),
      {scale: 0.92, y: 28, filter: "blur(10px)", opacity: 0},
      {scale: 1, y: 0, filter: "blur(0px)", opacity: 1, duration: 0.55, ease: "power3.out"});
    gsap.fromTo(f.viewer, {opacity: 0}, {opacity: 1, duration: 0.3});
  }
}

function close(){
  if(!openKey) return;
  openKey = null;
  const f = frame();
  if(!f.viewer) return;
  const g = ++gen;
  let settled = false;
  let guard = null;
  const done = () => {
    if(settled || g !== gen) return;   // 期间已重新开窗 → 放弃本次收尾
    settled = true;
    if(guard) clearTimeout(guard);
    f.viewer.hidden = true;
    f.viewer.style.opacity = "";
    f.iframe.src = ""; // 释放场景内存/GPU
  };
  killTweens(f.viewer);
  if(window.gsap && !motionOff()){
    gsap.to(f.viewer.querySelector(".scene-frame"),
      {scale: 0.94, y: 18, filter: "blur(8px)", opacity: 0, duration: 0.32, ease: "power2.in"});
    gsap.to(f.viewer, {opacity: 0, duration: 0.3, onComplete: done});
    guard = setTimeout(done, 500); // 后台标签页 rAF 会停摆，GSAP 补间冻结（踩坑 #014）
  }else done();
}

function init(){
  const btn = document.getElementById("scene-close");
  const viewer = document.getElementById("scene-viewer");
  if(btn) btn.addEventListener("click", close);
  if(viewer) viewer.addEventListener("click", e => { if(e.target === viewer) close(); });
  document.addEventListener("keydown", e => { if(e.key === "Escape" && openKey) close(); });
}

WB.registerModule({id: "scenes-internal", title: "窗景", icon: "image", hidden: true, render(){}});

WB.scenes = {open, close, SCENES, init};
})();

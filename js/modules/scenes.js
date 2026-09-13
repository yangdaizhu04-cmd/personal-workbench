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

function frame(){
  return {
    viewer: document.getElementById("scene-viewer"),
    iframe: document.getElementById("scene-iframe"),
    title: document.getElementById("scene-title"),
  };
}

function open(key){
  const s = SCENES[key];
  if(!s) return;
  if(window.WB_SINGLE_FILE){ WB.ui.toast("单文件版不含窗景，用文件夹版（启动工作台.bat）打开"); return; }
  const f = frame();
  if(!f.viewer || !f.iframe) return;
  openKey = key;
  f.title.textContent = s.title;
  f.iframe.src = s.file; // 关闭时清空释放 GPU
  f.viewer.hidden = false;
  const noMotion = document.documentElement.classList.contains("no-motion");
  if(window.gsap && !noMotion){
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
  const done = () => {
    f.viewer.hidden = true;
    f.iframe.src = ""; // 释放场景内存/GPU
  };
  const noMotion = document.documentElement.classList.contains("no-motion");
  if(window.gsap && !noMotion){
    gsap.to(f.viewer.querySelector(".scene-frame"),
      {scale: 0.94, y: 18, filter: "blur(8px)", opacity: 0, duration: 0.32, ease: "power2.in",
       onComplete: done});
    gsap.to(f.viewer, {opacity: 0, duration: 0.3});
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

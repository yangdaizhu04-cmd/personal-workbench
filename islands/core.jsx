/* core.jsx —— ThreeUI 视觉 island：动态壁纸（晨露/夜雾星座）+ 番茄钟专注球体
   挂载点：#bg-shader（壁纸动态层）、#focus-orb（番茄钟圆孔，由 pomodoro.js 持有并复用）
   通信：html[data-theme]/body.bg-dynamic-on 变化经 MutationObserver；球体经 WB.bus "pomo:phase" */
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { CondensationBackground } from "./condensation/CondensationBackground";
import { LiquidFormBackground } from "../../../灵感开发项目一/threeui/src/shaders/liquid-form/LiquidFormBackground";
import { EnergyOrb } from "../../../灵感开发项目一/threeui/src/shaders/energy-orb/EnergyOrb";

/* ---------- 动态壁纸层 ---------- */
const bgHost = document.getElementById("bg-shader");
if (bgHost && !document.documentElement.classList.contains("no-motion")) {
  document.body.classList.add("wb-islands"); // 单文件版无 islands：光斑不被动态模式隐藏
  let bgKind = null;
  const slotRoots = new Map();   // slot 元素 → 它自己的 React root（卸载时必须成对）

  const NightIframe = () => h("iframe", {
    src: "vendor/threeui/pages/constellation-night.html",
    title: "夜雾星座",
    className: "bg-scene-iframe",
    scrolling: "no",
    tabIndex: -1,
    loading: "eager",
  });

  function bgDesired() {
    if (!document.body.classList.contains("bg-dynamic-on")) return null;
    if (document.documentElement.classList.contains("no-motion")) return null;
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function mountSlot(box, key) {
    const root = createRoot(box);
    slotRoots.set(box, root);
    if (key === "light") {
      root.render(h(CondensationBackground, { speed: 0.7, dropAmount: 0.8, opacity: 0.55 }));
    } else {
      root.render(h(NightIframe));
    }
  }

  function dropSlot(box) {
    const root = slotRoots.get(box);
    slotRoots.delete(box);
    if (root) root.unmount();
    box.remove();
  }

  /* 双槽位交叉淡入（2.3）：新层先以 opacity:0 挂载，下一帧加 .is-on；
     旧层淡出后再卸载。整层替换（组件 ↔ iframe）时因此是淡出淡入，而不是换源白屏。 */
  function fadeInSlot(key) {
    const box = document.createElement("div");
    box.className = "bg-slot";
    bgHost.appendChild(box);
    mountSlot(box, key);
    requestAnimationFrame(() => box.classList.add("is-on"));
    return box;
  }

  function fadeOutSlot(box) {
    box.classList.remove("is-on");
    setTimeout(() => dropSlot(box), 700);   // 与 --dur-scene 对齐
  }

  function bgSync() {
    const want = bgDesired();
    if (want === bgKind) return;
    bgKind = want;
    const olds = Array.from(bgHost.querySelectorAll(".bg-slot.is-on"));
    if (want) fadeInSlot(want);
    olds.forEach(fadeOutSlot);
  }

  new MutationObserver(bgSync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  new MutationObserver(bgSync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  bgSync();
}

/* ---------- 番茄钟专注球体 ---------- */
const orbHost = document.getElementById("focus-orb");
if (orbHost && window.WB && WB.bus) {
  const orbRoot = createRoot(orbHost);
  let cur = null;
  let lastPhase = null;

  function orbSync(p) {
    if (p) lastPhase = p;
    const phase = p && p.phase;
    const want = phase === "focus-running" ? "pearl"
      : (phase === "rest-running" || phase === "celebrate") ? "planet"
      : null;
    orbHost.classList.toggle("is-paused", phase === "focus-paused" || phase === "rest-paused");
    if (want === cur) return;
    cur = want;
    orbHost.dataset.state = want || "idle";
    if (!want) { orbRoot.render(null); return; }
    if (want === "pearl") {
      orbRoot.render(h(LiquidFormBackground, { speed: 0.55, morph: 1, noiseScale: 1, mouseAmount: 0.06, metal: 1, camera: 6.2 }));
    } else {
      orbRoot.render(h(EnergyOrb, { hue: 145, saturation: 0.85, glow: 1.5, brightness: 1.6, starDensity: 0.6, speed: 0.8 }));
    }
  }

  /* pomodoro 每次渲染会把宿主节点重新搬进计时卡；搬完发 attach 事件强制刷新，
     兼顾 WebGL 上下文在宿主短暂脱离 DOM 后失效的情况 */
  WB.bus.on("pomo:orb-attach", () => { cur = null; orbSync(null); orbSync(lastPhase); });
  WB.bus.on("pomo:phase", orbSync);
}

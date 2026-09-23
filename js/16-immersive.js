/* 16-immersive.js —— 沉浸专注层（Focus Stage）：全屏场景 + 细线环 + 巨型数字 + 环境音联动
   设计参考：Lumora 的沉浸式番茄钟（全屏场景 / 1.5px 细线环 / 巨型衬线数字 / 一键隐藏全部 UI）。

   工程约束（与 待优化.md §4.3 一致，改这里前先读那段）：
   · 所有动画走 CSS class / keyframes，JS 只改 class、textContent、stroke-dashoffset；
     绝不写内联 animation / transition，否则绕过 html.no-motion 的 !important 熔断
   · 「在不在沉浸」一律读 active 相位变量，不看 DOM（踩坑 #028 的约定）
   · 退出时用代次令牌 gen 兜底，避免「退场 700ms 内又进入」被旧定时器误伤（踩坑 #035）
   · 层级用 --z-sheet(110)：压住 #app(1) 与 #bottombar(90)，又低于 modal-scrim(120)、
     cmdk(150)、toast(160)、fx-canvas(180)、pomo-flash(190) → 沉浸中弹确认框/吐司/彩带都不用抬层
   · 计时永远用 WB.pomodoro 的时间戳制状态，本层只订阅 pomo:tick / pomo:phase，不自己数秒 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* 场景表（id → 中文名）。id 同时也是 CSS 的 data-scene 与视频文件名 vendor/video/{id}.mp4；
   2026-09-22 由 4 场景扩到 8 场景：后四席定为「世界自然风光」（雪山/湖泊/碧海/草甸）。
   中途曾试过室内组（咖啡馆/书房/雨窗/暖灯），用户评价「效果非常差」后整体换成风光。
   2026-09-23 由 8 扩到 12（风光 B 组：沙丘/林间/飞瀑/云海），口径延续「世界自然风光 + 电影感」；
   原定的「秋色枫林」在 Mixkit 整批 Restricted（素材页 copyrightNotice 与 403 双双命中），
   换成「云海之上」承接（选材与授权核验见 vendor/video/README.md）。 */
const SCENES = {mist: "晨雾", deep: "深海", ember: "篝火", star: "星野",
  snow: "雪山", lake: "湖泊", sea: "碧海", meadow: "草甸",
  dune: "沙丘", glade: "林间", fall: "飞瀑", cloud: "云海"};
const SCENE_ORDER = ["mist", "deep", "ember", "star", "snow", "lake", "sea", "meadow",
  "dune", "glade", "fall", "cloud"];
/* 场景 → 推荐环境音（键与 sound.js 的 SRC_META 一致）。
   只做「提示」不做自动化：切场景时如果还没开任何声音，提一句就好 ——
   用户手动调过的声音组合不能被场景切换悄悄改掉 */
const SOUND_HINT = {
  mist: ["pad", "晨间氛围"], deep: ["white", "白噪"], ember: ["fire", "篝火"],
  star: ["lofi", "Lo-Fi 心流"], snow: ["piano", "钢琴"], lake: ["waves", "海浪"],
  sea: ["waves", "海浪"], meadow: ["piano", "钢琴"],
  dune: ["lofi", "Lo-Fi 心流"], glade: ["pad", "晨间氛围"],
  fall: ["waves", "海浪"], cloud: ["white", "白噪"],
};
const HIDE_MOUSE = 3200, HIDE_TOUCH = 4600;
const BREATH_MS = 19000;      // 4-7-8：吸 4s / 屏 7s / 呼 8s，与 CSS 的 breathe-478 严格同步
const DUCK_LEVEL = .55;       // 专注中环境音压到 55%
const WARMTH_MAX = .28;       // 进度色温上限（专注走到头时场景"特征光"的浓度，太高会盖住可读性）

let active = false;           // 相位：是否在沉浸
let gen = 0;                  // 代次令牌
let stage = null, parts = null;
let ringFore = null, ringCirc = 0;
let cells = [], lastTime = "", lastScene = "", ctrlSig = "", lastWarm = -1;
let hideTimer = null, hideDelay = HIDE_MOUSE, lastWake = 0, chromeHidden = false;
let prepTimer = null, prepCount = 0, breathTimer = null, clockTimer = null, noteTimer = null;
let resizeTimer = null;
let fsAsked = false, titleBefore = "";
const mediaBound = [];

/* ---------- 小工具 ---------- */
const th = () => WB.theme.all();
function session(){ return WB.pomodoro && WB.pomodoro.state ? WB.pomodoro.state() : null; }
function fmtClock(sec){
  sec = Math.max(0, Math.round(sec));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}
function todayPomos(){
  const today = WB.bizDate();
  return WB.store.get("pomoLog", []).filter(l =>
    l.date === today && l.mode === "focus" && l.status === "done").length;
}
function setText(node, text){ if(node && node.textContent !== text) node.textContent = text; }
function sceneId(){
  const id = th().pomoImmersiveScene;
  return SCENES[id] ? id : "mist";
}

/* ---------- 建 DOM（只建一次，之后只改文本/class） ---------- */
function build(){
  if(stage) return;
  stage = document.createElement("div");
  stage.id = "focus-stage";
  stage.hidden = true;
  stage.setAttribute("role", "dialog");
  stage.setAttribute("aria-label", "沉浸专注");
  stage.setAttribute("aria-hidden", "true");
  stage.innerHTML =
    '<div class="fs-scene" data-scene="mist">' +
      '<div class="fs-glow fs-glow-a"></div><div class="fs-glow fs-glow-b"></div>' +
      '<div class="fs-fx"></div>' +                                       /* 每个场景自己的动态层（星点/波光/火光/雾带） */
    '</div>' +
    /* 循环视频背景（vendor/video/*.mp4，见那边的 README）：只在沉浸时挂 src，
       永远是叠加层 —— 失败/离线/单文件版就露出下面的 CSS 场景 */
    '<video class="fs-video" muted loop playsinline preload="none" aria-hidden="true"></video>' +
    '<div class="fs-tint"></div>' +                                       /* 进度色温：随番茄进度缓慢变浓 */
    '<div class="fs-veil"></div>' +
    '<div class="fs-halo"></div>' +                                       /* 有视频时才亮起：给数字与上下控件留可读区 */
    '<div class="fs-body">' +
      '<header class="fs-top">' +
        '<div class="fs-brand"><span class="fs-dot"></span><span class="fs-scene-name"></span><span class="fs-bind"></span></div>' +
        '<div class="fs-tools">' +
          '<button class="fs-tool" data-act="scene" title="选择场景（12 套）">◐</button>' +
          '<button class="fs-tool" data-act="sound" title="环境音开关（M）">♪</button>' +
          '<button class="fs-tool" data-act="close" title="退出沉浸（Esc）">✕</button>' +
        '</div>' +
      '</header>' +
      '<main class="fs-center">' +
        '<div class="fs-ringwrap"><div class="fs-ring"></div><div class="fs-time"></div></div>' +
        '<div class="fs-phase"></div>' +
        '<div class="fs-task" hidden></div>' +
        '<div class="fs-breath"></div>' +
      '</main>' +
      '<footer class="fs-bottom">' +
        '<div class="fs-meta"><span class="fs-clock"></span><span class="fs-today"></span></div>' +
        '<div class="fs-controls"></div>' +
        '<div class="fs-hint">← → 换景 · M 静音 · 空格 暂停/继续 · Esc 退出</div>' +
      '</footer>' +
    '</div>' +
    '<div class="fs-note" hidden></div>' +
    /* 场景选择面板（12 场景：点「◐」直接选，不再循环切换）：网格按钮 + 每个场景一个色点，
       点遮罩空白处或 Esc 关闭 */
    '<div class="fs-picker" hidden>' +
      '<div class="fs-picker-box" role="listbox" aria-label="选择场景">' +
        SCENE_ORDER.map(id => '<button class="fs-pick" data-pick="' + id + '" role="option" aria-selected="false">' +
          '<span class="fs-pick-dot" data-scene="' + id + '"></span>' +
          '<span class="fs-pick-name">' + SCENES[id] + '</span></button>').join("") +
      '</div>' +
    '</div>' +
    '<div class="fs-prep" hidden><div class="fs-prep-num"></div><div class="fs-prep-text">收拢注意力，我们开始了</div></div>';
  document.body.appendChild(stage);

  const q = s => stage.querySelector(s);
  parts = {
    scene: q(".fs-scene"), ring: q(".fs-ring"), time: q(".fs-time"), ringwrap: q(".fs-ringwrap"),
    phase: q(".fs-phase"), task: q(".fs-task"), breath: q(".fs-breath"),
    controls: q(".fs-controls"), clock: q(".fs-clock"), today: q(".fs-today"),
    sceneName: q(".fs-scene-name"), bind: q(".fs-bind"),
    note: q(".fs-note"), prep: q(".fs-prep"), prepNum: q(".fs-prep-num"),
    video: q(".fs-video"), picker: q(".fs-picker"),
  };
  parts.controls.addEventListener("click", onControlClick);
  q(".fs-tools").addEventListener("click", onToolClick);
  parts.picker.addEventListener("click", onPickerClick);
  stage.addEventListener("click", onStageClick);
  stage.addEventListener("mousemove", () => wake(HIDE_MOUSE));
  stage.addEventListener("touchstart", () => wake(HIDE_TOUCH), {passive: true});
  /* 面板开着时 Esc 先关面板、不退出沉浸：capture 阶段拦截并阻断冒泡，
     不让 main.js 的全局 Esc（退出沉浸）收到 */
  addEventListener("keydown", e => {
    if(e.key === "Escape" && pickerShown){
      e.preventDefault();
      e.stopPropagation();
      closePicker();
      wake();
    }
  }, true);
  addEventListener("resize", onResize);
}

/* ---------- 进度环（自建：细线 + 起点 12 点 + 1s 线性补间，配色读场景变量） ---------- */
function buildRing(){
  const size = Math.round(WB.clamp(Math.min(innerWidth, innerHeight) * .62, 232, 520));
  const stroke = size <= 300 ? 1.4 : 1.6;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  ringCirc = c;
  parts.ring.style.width = size + "px";
  parts.ring.style.height = size + "px";
  parts.ring.innerHTML =
    '<svg width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle class="fs-c-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke + '"/>' +
      '<circle class="fs-c-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke-width="' + stroke +
        '" stroke-dasharray="' + c + '" stroke-dashoffset="' + c + '"/>' +
    '</svg>';
  ringFore = parts.ring.querySelector(".fs-c-fg");
}
/* 逐字符定宽：非等宽字体下巨型数字不会左右跳（0.58em/位、冒号 0.42em） */
function setTime(str){
  if(str === lastTime) return;
  if(cells.length !== str.length){
    parts.time.innerHTML = "";
    cells = [];
    for(let i = 0; i < str.length; i++){
      const sp = document.createElement("span");
      sp.className = "fs-ch";
      parts.time.appendChild(sp);
      cells.push(sp);
    }
  }
  for(let i = 0; i < cells.length; i++){
    const ch = str[i];
    if(cells[i].__ch === ch) continue;
    cells[i].__ch = ch;
    cells[i].textContent = ch;
    cells[i].classList.toggle("is-colon", ch === ":");
  }
  lastTime = str;
}

/* ---------- 循环视频背景（vendor/video/，台账见那里的 README） ----------
   三条硬约定：① 只有沉浸层打开时才挂 src，退出即 pause + 清 src 释放解码器；
   ② 视频永远只是叠加层，CSS 场景始终在它下面 —— 失败/离线/单文件版自然露出场景；
   ③ 单文件版（自包含）与 html.no-motion 一律不加载，两版能力一致降级 */
const VIDEO_DIR = "vendor/video/";
const videoBlocked = {};      // 出错过的场景：本次会话不再重试
function videoAllowed(){
  return th().pomoImmersiveVideo !== false && !window.WB_SINGLE_FILE && !WB.ui.motionOff();
}
function videoShow(id){
  const v = parts && parts.video;
  if(!v) return;
  if(!videoAllowed() || videoBlocked[id]){ videoUnload(); return; }
  if(v.__scene === id) return;                       // 已指向这一支，别重挂
  v.__scene = id;
  v.classList.remove("is-on");
  stage.classList.remove("has-video");               // 先让场景动态层回来（换场时也有东西看）
  v.oncanplay = () => {
    if(!active || v.__scene !== id) return;
    const p = v.play();
    if(p && p.catch) p.catch(() => { videoBlocked[id] = true; });
  };
  v.onplaying = () => {
    if(v.__scene !== id) return;
    v.classList.add("is-on");
    stage.classList.add("has-video");                // CSS 里据此停掉场景动态层（省 GPU）
  };
  v.onerror = () => {
    videoBlocked[id] = true;
    videoUnload();
  };
  v.setAttribute("src", VIDEO_DIR + id + ".mp4");
  try{ v.load(); }catch(e){}
}
function videoUnload(){
  const v = parts && parts.video;
  if(!v) return;
  v.oncanplay = v.onplaying = v.onerror = null;
  v.__scene = "";
  try{ v.pause(); }catch(e){}
  v.classList.remove("is-on");
  if(stage) stage.classList.remove("has-video");
  v.removeAttribute("src");
  try{ v.load(); }catch(e){}                         // 真正释放缓冲与解码器
}

/* ---------- 场景（渐变不可插值 → 双槽位交叉淡入，沿用 §8c 的手法） ---------- */
function setScene(id, fade){
  id = SCENES[id] ? id : "mist";
  if(!parts) return;
  if(fade && lastScene && lastScene !== id){
    const old = parts.scene.cloneNode(true);
    old.dataset.scene = lastScene;
    old.classList.add("fs-scene-out");
    parts.scene.parentNode.insertBefore(old, parts.scene.nextSibling);
    requestAnimationFrame(() => old.classList.add("is-gone"));
    setTimeout(() => old.remove(), 780);
  }
  parts.scene.dataset.scene = id;
  stage.dataset.scene = id;
  lastScene = id;
  setText(parts.sceneName, SCENES[id]);
  if(active) videoShow(id);       // 换场景同步换片（播放中会被 is-on 淡出，露出 CSS 场景再淡入新的）
}
/* 场景 → 推荐环境音：只在用户主动换场景时提一句，同一场景每次沉浸只说一次，
   且已经有声音在播时不打扰 —— 绝不动用户的播放状态 */
let hintShown = null;
function soundHint(id){
  const h = SOUND_HINT[id];
  if(!h || !WB.sound || !WB.ui || !WB.ui.toast) return;
  if(WB.sound.anyPlaying && WB.sound.anyPlaying()) return;
  if(!hintShown) hintShown = {};
  if(hintShown[id]) return;
  hintShown[id] = true;
  WB.ui.toast(SCENES[id] + "配「" + h[1] + "」更好听 ♪（声音面板里选）");
}

/* ---------- 场景选择面板（12 场景：点「◐」弹出网格直接选） ---------- */
let pickerShown = false, pickerTimer = null;
function paintPicker(){
  if(!parts) return;
  parts.picker.querySelectorAll(".fs-pick").forEach(b => {
    const on = b.dataset.pick === lastScene;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}
function openPicker(){
  if(!parts || pickerShown) return;
  pickerShown = true;
  clearTimeout(pickerTimer);
  paintPicker();
  parts.picker.hidden = false;
  requestAnimationFrame(() => { if(pickerShown) parts.picker.classList.add("is-on"); });
}
function closePicker(){
  if(!parts || !pickerShown) return;
  pickerShown = false;
  parts.picker.classList.remove("is-on");
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(() => { if(parts && !pickerShown) parts.picker.hidden = true; }, 320);
}
/* 换景的唯一出口：记住偏好 + 在沉浸中就立即换（面板 / 番茄卡 / ⌘K 三处共用同一条路径）。
   广播 view:dirty 是为了让番茄卡底部的场景色点条跟着高亮 —— 沉浸里换完再退出时它不是过期 DOM */
function pick(id){
  if(!SCENES[id]) return;
  WB.theme.set("pomoImmersiveScene", id);
  if(active) setScene(id, true);
  WB.bus.emit("view:dirty");
}
/* ← / → = 上一个 / 下一个场景，按 SCENE_ORDER 首尾循环。
   换景后把场景名浮一下：控件可能已自动隐藏，不提示就不知道换到了哪一支 */
function step(dir){
  const i = SCENE_ORDER.indexOf(lastScene);
  if(i < 0) return;
  const n = SCENE_ORDER.length;
  const id = SCENE_ORDER[((i + (dir || 1)) % n + n) % n];
  pick(id);
  wake();
  showNote(SCENES[id], 1400);
}
/* M = 环境音全开关（等同点右上角 ♪） */
function toggleSound(){
  if(WB.sound && WB.sound.toggle) WB.sound.toggle();
  paintSoundBtn();
}
function onPickerClick(e){
  const b = e.target.closest("[data-pick]");
  if(b){
    const id = b.dataset.pick;
    if(SCENES[id]){
      pick(id);
      paintPicker();
      soundHint(id);
    }
    closePicker();
    wake();
    return;
  }
  if(!e.target.closest(".fs-picker-box")) closePicker();   // 点遮罩空白处关闭
}

/* ---------- UI 隐藏：静止自动隐藏 + 点击背景切换 ---------- */
function wake(delay){
  if(!active) return;
  if(chromeHidden){ chromeHidden = false; stage.classList.remove("chrome-hidden"); }
  const now = Date.now();
  if(now - lastWake < 220 && hideTimer) return;   // 高频 mousemove 不重复排期
  lastWake = now;
  hideDelay = delay || HIDE_MOUSE;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if(!active) return;
    chromeHidden = true;
    stage.classList.add("chrome-hidden");
  }, hideDelay);
}
function toggleChrome(){
  clearTimeout(hideTimer);
  chromeHidden = !chromeHidden;
  stage.classList.toggle("chrome-hidden", chromeHidden);
  if(!chromeHidden) wake(hideDelay);
}

/* ---------- 中央提示语 ---------- */
function showNote(text, ms){
  if(!parts || !text) return;
  parts.note.textContent = text;
  parts.note.hidden = false;
  clearTimeout(noteTimer);
  requestAnimationFrame(() => parts.note.classList.add("is-on"));
  noteTimer = setTimeout(() => {
    noteTimer = null;
    if(!parts) return;
    parts.note.classList.remove("is-on");
    noteTimer = setTimeout(() => { if(parts) parts.note.hidden = true; }, 700);
  }, ms || 3000);
}

/* ---------- 3-2-1 准备倒数（引导，可关） ---------- */
function prepStart(){
  if(!parts || th().pomoImmersiveGuide === false) return;
  prepCount = 3;
  parts.prep.hidden = false;
  stage.classList.add("is-prep");
  const paint = () => {
    parts.prepNum.textContent = String(prepCount);
    parts.prepNum.classList.remove("is-in");
    void parts.prepNum.offsetWidth;      // 重挂动画：数字缩放入场（420ms，CSS 里定义）
    parts.prepNum.classList.add("is-in");
  };
  paint();
  clearInterval(prepTimer);
  prepTimer = setInterval(() => {
    prepCount--;
    if(prepCount <= 0){
      clearInterval(prepTimer);
      prepTimer = null;
      stage.classList.remove("is-prep");
      parts.prep.classList.add("is-leaving");
      setTimeout(() => {
        if(parts){ parts.prep.hidden = true; parts.prep.classList.remove("is-leaving"); }
      }, 520);
      return;
    }
    paint();
  }, 1100);
}

/* ---------- 4-7-8 呼吸引导（仅休息运行中） ---------- */
function breath(){
  if(!parts) return;
  const s = session();
  const on = th().pomoImmersiveGuide !== false && s && s.mode === "rest" && s.running;
  if(!on){
    if(breathTimer){ clearInterval(breathTimer); breathTimer = null; }
    parts.ringwrap.classList.remove("is-breathing");
    setText(parts.breath, "");
    parts.breath.hidden = true;
    return;
  }
  parts.breath.hidden = false;
  parts.ringwrap.classList.add("is-breathing");
  if(breathTimer) return;
  const t0 = Date.now();
  const paint = () => {
    const k = (Date.now() - t0) % BREATH_MS;
    setText(parts.breath, k < 4000 ? "吸气…" : k < 11000 ? "屏住" : "呼气…");
  };
  paint();
  breathTimer = setInterval(paint, 500);
}

/* ---------- 控制条 ---------- */
function mkBtn(act, glyph, label, main){
  const b = document.createElement("button");
  b.className = "fs-btn" + (main ? " fs-btn-main" : "");
  b.dataset.act = act;
  b.setAttribute("aria-label", label);
  b.setAttribute("title", label);
  b.innerHTML = '<span class="fs-ic"></span><span class="fs-lb"></span>';
  b.querySelector(".fs-ic").textContent = glyph;
  b.querySelector(".fs-lb").textContent = label;
  return b;
}
function paintControls(s){
  const sig = s.needConfirm ? "confirm-" + s.mode : "live";
  if(sig !== ctrlSig){
    ctrlSig = sig;
    parts.controls.innerHTML = "";
    const rows = s.needConfirm
      ? (s.mode === "focus" ? [["next", "☕", "开始休息"], ["done", "✕", "先到这"]]
                            : [["next", "▶", "下一轮专注"], ["done", "✕", "先到这"]])
      : [["run", "⏸", "暂停"], ["finish", "✓", s.mode === "focus" ? "完成本段" : "结束休息"], ["abandon", "✕", "放弃"]];
    rows.forEach((r, i) => parts.controls.appendChild(mkBtn(r[0], r[1], r[2], i === 0)));
  }
  if(sig === "live"){
    const run = parts.controls.querySelector('[data-act="run"]');
    if(run){
      setText(run.querySelector(".fs-ic"), s.running ? "⏸" : "▶");
      setText(run.querySelector(".fs-lb"), s.running ? "暂停" : "继续");
    }
    const fin = parts.controls.querySelector('[data-act="finish"] .fs-lb');
    setText(fin, s.mode === "focus" ? "完成本段" : "结束休息");
  }
}
function paintSoundBtn(){
  if(!parts) return;
  const b = stage.querySelector('[data-act="sound"]');
  if(!b) return;
  b.classList.toggle("is-off", !(WB.sound && WB.sound.anyPlaying && WB.sound.anyPlaying()));
}
function onControlClick(e){
  const b = e.target.closest("[data-act]");
  if(!b) return;
  wake();
  const act = b.dataset.act;
  if(act === "run") toggleRun();
  else if(act === "finish") finishPhase();
  else if(act === "abandon") abandon();
  else if(act === "next"){ if(WB.pomodoro.confirmNext) WB.pomodoro.confirmNext(); render(); }
  else if(act === "done"){ if(WB.pomodoro.stopAndClear) WB.pomodoro.stopAndClear(); else exit(); }
}
function onToolClick(e){
  const b = e.target.closest("[data-act]");
  if(!b) return;
  const act = b.dataset.act;
  if(act === "close") exit();
  else if(act === "sound"){ toggleSound(); wake(); }
  else if(act === "scene"){ pickerShown ? closePicker() : openPicker(); wake(); }
}
function onStageClick(e){
  if(e.target.closest(".fs-tools, .fs-controls")) return;
  toggleChrome();
}

/* ---------- 时钟 / 标题 / 锁屏 ---------- */
function paintClock(){
  if(!parts) return;
  const d = new Date();
  setText(parts.clock, String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"));
}
function titleSync(){
  if(!active) return;
  if(WB.pomodoro.titleFlashing && WB.pomodoro.titleFlashing()) return;  // 结束时的标题闪烁优先
  const s = session();
  if(!s) return;
  const tail = s.needConfirm ? (s.mode === "focus" ? "专注完成" : "休息结束")
    : (s.running ? (s.mode === "focus" ? "专注" : "休息") : "已暂停");
  document.title = fmtClock(s.remainSec) + " · " + tail + " · 个人工作台";
}
function bindMedia(name, fn){
  try{ navigator.mediaSession.setActionHandler(name, fn); mediaBound.push(name); }catch(e){}
}
/* 元数据 + 播放态同步：状态一变就得更新，不能只在进入沉浸那一刻写一次 ——
   否则沉浸里暂停后，锁屏/耳机键那套系统媒体面板还显示「正在播放」（踩坑 #057） */
function mediaSync(){
  if(!("mediaSession" in navigator)) return;
  const s = session();
  if(!s) return;
  try{
    if(typeof MediaMetadata === "function")
      navigator.mediaSession.metadata = new MediaMetadata({
        title: (s.mode === "focus" ? "专注 " : "休息 ") + Math.round(s.plannedSec / 60) + " 分钟",
        artist: s.bindTitle || "个人工作台 · 番茄钟",
        album: "沉浸专注",
      });
    navigator.mediaSession.playbackState = (s.running && !s.needConfirm) ? "playing" : "paused";
  }catch(e){}
  mediaPos();
}
function mediaBind(){
  if(!("mediaSession" in navigator)) return;
  const s = session();
  if(!s) return;
  try{
    bindMedia("play", () => { const x = session(); if(x && !x.running && WB.pomodoro.resume) WB.pomodoro.resume(); });
    bindMedia("pause", () => { const x = session(); if(x && x.running && WB.pomodoro.pause) WB.pomodoro.pause(); });
    bindMedia("stop", () => exit());
    bindMedia("nexttrack", () => finishPhase());
  }catch(e){}
  mediaSync();
}
function mediaPos(){
  if(!("mediaSession" in navigator)) return;
  const s = session();
  if(!s || !navigator.mediaSession.setPositionState) return;
  try{
    navigator.mediaSession.setPositionState({
      duration: s.plannedSec,
      position: WB.clamp(s.plannedSec - s.remainSec, 0, s.plannedSec),
      playbackRate: 1,
    });
  }catch(e){}
}
function mediaOff(){
  if(!("mediaSession" in navigator)) return;
  try{
    mediaBound.forEach(n => { try{ navigator.mediaSession.setActionHandler(n, null); }catch(e){} });
    mediaBound.length = 0;
    navigator.mediaSession.playbackState = "none";
    if(typeof MediaMetadata === "function") navigator.mediaSession.metadata = null;
  }catch(e){}
}

/* ---------- 全屏 ---------- */
function fullscreen(on){
  try{
    if(on){
      const req = document.documentElement.requestFullscreen;
      if(!req) return;
      const p = req.call(document.documentElement);
      if(p && p.catch) p.catch(() => {});      // 被拒（无用户激活/权限）时静默降级：只是不占满屏
    }else if(document.fullscreenElement && document.exitFullscreen){
      const p = document.exitFullscreen();
      if(p && p.catch) p.catch(() => {});
    }
  }catch(e){}
}

/* ---------- 环境音 ---------- */
function soundEnter(){
  if(!WB.sound) return;
  if(!(WB.sound.anyPlaying && WB.sound.anyPlaying()) && WB.sound.restoreCombo) WB.sound.restoreCombo();
  soundSync(600);
  setTimeout(paintSoundBtn, 700);       // 真实录音是异步起播的，稍后再校准按钮
  setTimeout(paintSoundBtn, 2000);
}
function soundSync(ms){
  if(!WB.sound || !WB.sound.setDuck) return;
  const s = session();
  const duckOn = th().pomoSoundDuck !== false;
  WB.sound.setDuck((s && s.running && s.mode === "focus" && duckOn) ? DUCK_LEVEL : 1, ms == null ? 900 : ms);
}

/* ---------- 渲染 ---------- */
function render(){
  if(!active || !parts) return;
  const s = session();
  if(!s){ exit(); return; }             // 放弃/结束时状态被清空 → 自动退出
  const focus = s.mode === "focus";
  setTime(fmtClock(s.remainSec));
  const pct = WB.clamp(s.plannedSec ? 1 - s.remainSec / s.plannedSec : 0, 0, 1);
  if(ringFore) ringFore.style.strokeDashoffset = String(ringCirc * (1 - pct));
  /* 进度色温：专注越往后场景的"特征光"越浓（0 → 0.28）；休息与待确认时退回 0。
     只写 CSS 变量，过渡本身在 .fs-tint 里声明（不绕过 no-motion 熔断） */
  const warm = (focus && !s.needConfirm) ? Math.round(pct * WARMTH_MAX * 1000) / 1000 : 0;
  if(warm !== lastWarm){
    lastWarm = warm;
    stage.style.setProperty("--fs-warmth", String(warm));
  }
  setText(parts.phase, s.needConfirm ? (focus ? "专注完成" : "休息结束")
    : (s.running ? (focus ? "专注中" : "休息中") : "已暂停"));
  const bind = s.bindTitle ? ((s.bindType === "skill" ? "⚡ " : "☑ ") + s.bindTitle) : "";
  parts.task.hidden = !bind;
  setText(parts.task, bind);
  setText(parts.bind, bind);
  if(WB.pomodoro.gardenStats){
    const g = WB.pomodoro.gardenStats();
    setText(parts.today, "今日 " + todayPomos() + " 个番茄 · 花园 " + g.flowers + " 朵花");
  }
  paintClock();
  paintControls(s);
  paintSoundBtn();
  breath();
  titleSync();
}
function showPhaseNote(){
  const s = session();
  if(!s) return;
  if(s.needConfirm) showNote(s.mode === "focus" ? "一段专注完成了 · 起身动一动，看看远处" : "休息结束 · 准备好就继续");
  else if(s.running) showNote(s.mode === "focus" ? "开始专注 · 这一段时间只做一件事" : "开始休息 · 松开肩膀，慢慢呼吸");
  else showNote("已暂停");
}
function onPhase(){
  soundSync();
  setTimeout(paintSoundBtn, 700);       // 音源可能在 pomo:start 之后才真正开播
  if(!active) return;
  mediaSync();                          // 暂停/继续/切段都要同步到系统媒体面板
  render();
  showPhaseNote();
}
function onResize(){
  if(!active) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if(active && parts){ buildRing(); render(); } }, 200);
}

/* ---------- 进出 ---------- */
function enter(opts){
  if(active) return;
  if(th().pomoImmersive === false){ WB.ui.toast("沉浸模式已在设置里关掉", "warn"); return; }
  const s = session();
  if(!s){ WB.ui.toast("先开始一段专注，再进沉浸", "warn"); return; }
  active = true;
  gen++;
  hintShown = null;                    // 每次进入沉浸，场景推荐提示可以再提一次
  build();
  const my = gen;
  /* 主题/场景/尺寸先落地，避免第一帧闪错配色 */
  setScene(sceneId(), false);
  buildRing();
  stage.hidden = false;
  document.body.classList.add("immersive-on", "immersive-fade");
  stage.setAttribute("aria-hidden", "false");
  void stage.offsetWidth;                                   // 让 opacity:0 → is-on 的过渡起跑
  stage.classList.add("is-on");
  fsAsked = th().pomoImmersiveFull !== false;
  if(fsAsked) fullscreen(true);
  titleBefore = document.title;
  render();
  prepStart();
  if(!prepTimer) showPhaseNote();                           // 没开引导就直接给提示语
  wake(HIDE_MOUSE);
  clockTimer = setInterval(paintClock, 15000);
  mediaBind();
  soundEnter();
  WB.bus.emit("immersive:changed", {active: true});
  if(!opts || !opts.auto) WB.ui.toast("沉浸专注 · 按 Esc 退出");
  if(my !== gen) exit();                                    // 极端竞态兜底
}
function exit(){
  if(!active) return;
  active = false;
  const my = ++gen;
  clearTimeout(hideTimer); hideTimer = null;
  clearTimeout(resizeTimer); resizeTimer = null;
  clearInterval(prepTimer); prepTimer = null;
  clearInterval(breathTimer); breathTimer = null;
  clearInterval(clockTimer); clockTimer = null;
  clearTimeout(noteTimer); noteTimer = null;
  chromeHidden = false;
  ctrlSig = "";
  if(stage){
    stage.classList.remove("is-on", "is-prep", "chrome-hidden");
    stage.setAttribute("aria-hidden", "true");
    stage.style.setProperty("--fs-warmth", "0");   // 色温归零，下次进入从冷起步
  }
  lastWarm = -1;
  if(parts){
    parts.prep.hidden = true;
    parts.prep.classList.remove("is-leaving");
    parts.note.classList.remove("is-on");
    parts.note.hidden = true;
    parts.ringwrap.classList.remove("is-breathing");
  }
  closePicker();                     // 面板若开着，退出时一起收掉（不留「下次进入时闪现」）
  videoUnload();                     // 退出即停并释放视频（不留解码器与缓冲）
  document.body.classList.remove("immersive-on");
  setTimeout(() => { if(my === gen) document.body.classList.remove("immersive-fade"); }, 760);
  if(fsAsked){ fsAsked = false; fullscreen(false); }
  mediaOff();
  document.title = titleBefore || document.title;
  soundSync(700);
  WB.bus.emit("immersive:changed", {active: false});
  if(stage && my === gen) setTimeout(() => { if(my === gen && stage) stage.hidden = true; }, 720);
}
function toggle(){ if(active) exit(); else enter(); }
/* 空格 = 主按钮：运行中暂停 / 暂停继续 / 待确认时推进到下一段
   （待确认时绝不能走 resume()：那会把已完成的这段重新跑起来，还会多记一条成绩） */
function toggleRun(){
  const s = session();
  if(!s) return;
  if(s.needConfirm){ finishPhase(); return; }
  if(s.running){ if(WB.pomodoro.pause) WB.pomodoro.pause(); }
  else if(WB.pomodoro.resume) WB.pomodoro.resume();
  render();
}
function finishPhase(){
  const s = session();
  if(!s) return;
  if(s.needConfirm){ if(WB.pomodoro.confirmNext) WB.pomodoro.confirmNext(); render(); }
  else if(WB.pomodoro.finish) WB.pomodoro.finish();
}
async function abandon(){
  const s = session();
  if(!s) return;
  if(s.mode === "focus" && s.elapsedSec >= 60){
    const ok = await WB.ui.confirmBox("中途放弃的话，小花园里的小苗会蔫掉 🥀 确定放弃？",
      {danger: true, okLabel: "放弃"});
    if(!ok) return;
  }
  if(WB.pomodoro.giveUp) WB.pomodoro.giveUp();
  exit();
}

/* ---------- 事件订阅 ---------- */
WB.bus.on("pomo:tick", () => {
  if(active){ render(); mediaPos(); }
});
WB.bus.on("pomo:phase", onPhase);
/* 开始专注：环境音从 0 渐入到策略音量（专注中压低 / 其余恢复）。
   本文件在 index.html 里排在 modules/sound.js 之前 → 这里先 duckReset(0)，
   等同一轮里 sound.js 的 restoreCombo() 建好音源后再按策略起跑，渐入才听得到 */
WB.bus.on("pomo:start", () => {
  if(!WB.sound || !WB.sound.setDuck) return;
  if(WB.sound.duckReset) WB.sound.duckReset(0);
  setTimeout(() => soundSync(1200), 0);
});
// 全屏被 Esc/F11 退出时同步退出沉浸（用户预期：退了全屏就不是沉浸态了）
document.addEventListener("fullscreenchange", () => {
  if(active && fsAsked && !document.fullscreenElement) exit();
});

WB.immersive = {
  enter, exit, toggle, toggleRun, finishPhase, abandon,
  pick, step, toggleSound,
  isActive(){ return active; },
  scene: setScene,
  scenes: SCENES,
  order: SCENE_ORDER,
  pickerOpen(){ return pickerShown; },
};
})();

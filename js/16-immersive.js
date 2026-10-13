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
/* 换景节流窗口（2026-10-14）：一次换景 = 换视频源 + 交叉淡入 + 偏好落盘 + 记账，
   按住 ←/→ 或连续快滑会把它们串成队列（main.js 的注释写明「不防连发」是刻意的），
   结果越按越卡。180ms 窗口内的重复请求直接丢弃 —— 用户感知仍是「连续翻景」 */
const STEP_MIN_MS = 180;
const WARM_DELAY = 900;       // 换景后多久去预热相邻场景（先让当下的合成跑完再吃网络）

let active = false;           // 相位：是否在沉浸
let gen = 0;                  // 代次令牌
let stage = null, parts = null;
let ringFore = null, ringCirc = 0;
let cells = [], lastTime = "", lastScene = "", ctrlSig = "", lastWarm = -1;
let hideTimer = null, hideDelay = HIDE_MOUSE, lastWake = 0, chromeHidden = false;
let prepTimer = null, prepCount = 0, breathTimer = null, clockTimer = null, noteTimer = null;
let resizeTimer = null;
let lastStepTs = 0;           // 上一次换景的时刻（连发节流用）
let warmTimer = null;         // 相邻场景预热的排期
let dirtyPending = false;     // 沉浸中换过景 → 退出时补刷一次视图
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
          '<button class="fs-tool" data-act="rotate" title="切换横屏 / 竖屏">⟳</button>' +
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
    /* 左右换景按钮：桌面端有 ← → 键、移动端有左右滑动，这里再给"想直接点一下"的人
       一个看得见的入口。与顶/底栏一起随控件层隐显（见 CSS 的 .chrome-hidden） */
    '<button class="fs-arrow fs-arrow-l" data-act="prev" aria-label="上一个场景" title="上一个场景">‹</button>' +
    '<button class="fs-arrow fs-arrow-r" data-act="next" aria-label="下一个场景" title="下一个场景">›</button>' +
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
  /* 触屏：一次 touchstart 同时管唤醒控件层与记录滑动起点，避免挂两个同类型监听 */
  stage.addEventListener("touchstart", e => { wake(HIDE_TOUCH); swipeStart(e); }, {passive: true});
  stage.addEventListener("touchend", swipeEnd, {passive: true});
  stage.addEventListener("touchcancel", () => { swipeOn = false; }, {passive: true});
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
  /* 环的边长一律取「宽高较小者 × .62」。横屏的瓶颈是高度，直接套同一套算法即可 ——
     359 × .62 ≈ 222px，配合横屏底栏改横排后剩下的高度正好放得下，
     不需要为横屏单开一套系数 */
  const size = Math.round(WB.clamp(Math.min(innerWidth, innerHeight) * .62, 148, 520));
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
/* ---------- 性能分档（低端设备降级） ----------
   同一套动画在旗舰机上是「质感」，在入门机上是「卡顿」。判定只看硬件画像
   （deviceMemory / hardwareConcurrency），不做机型嗅探；命中即降档：
     · CSS 侧（#focus-stage.fs-lite）：光斑 blur 70px → 20px、场景动态层与漂移全部停下；
     · JS 侧（setScene）：不做双槽位交叉淡入（省掉克隆层与 780ms 的双份全屏重绘）。
   循环视频**不**在降档范围内 —— 沉浸视频是这套体验的核心，低端机也不该被剥夺；
   真要关有设置里的「沉浸视频背景」（pomoImmersiveVideo）。判不出来（Safari 无 deviceMemory）
   一律按不降档处理：降档是兜底，不是默认。 */
let liteCache = null;
function perfLite(){
  if(liteCache !== null) return liteCache;
  liteCache = false;
  try{
    const dm = navigator.deviceMemory, hc = navigator.hardwareConcurrency;
    if(typeof dm === "number" && dm > 0 && dm <= 4) liteCache = true;
    else if(typeof hc === "number" && hc > 0 && hc <= 4) liteCache = true;
  }catch(e){ /* 取不到就当不降档 */ }
  return liteCache;
}
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
  /* 这里**刻意不摘** has-video（2026-10-14 换景卡顿整改）：摘掉会让 css 里那条
     「#focus-stage.has-video .fs-glow/.fs-fx{opacity:0; animation-play-state:paused}」同时失效，
     于是换景那一瞬要同时跑：旧场景克隆层 + 新场景层 + 两个 58vmax 的 blur(70px) 光斑
     + .fs-fx 双伪元素动画 —— 手机 GPU 的峰值就是这么来的。
     底下的 CSS 场景层一直都在，旧视频淡出时它自然露出来，不需要靠「恢复动态层」撑场面；
     真正卸载视频（失败/退出）时才摘（见 videoUnload）。 */
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
/* ---------- 相邻场景预热（换景不空窗） ----------
   preload="none" + 「切到哪支才拉哪支」= 每支视频的第一次切换都要等一次全量加载
   （glade 7.23MB / meadow 6.82MB / star 5.71MB，12 支合计 38.68MB）。
   这里在进入沉浸后与每次换景后，把当前场景的**前后各 1 支**用 fetch 预取：
     · Web/云版：Service Worker 是 cache-first，fetch 会把字节放进同一份缓存，之后切过去直接命中；
     · App 版：走 WebView/本地 HTTP 缓存，命不中也只是多读一次本地文件，无副作用；
     · 单文件版 / 低端降级（videoAllowed() === false）一律跳过。
   只预热 ±1，不做全量 —— 全量预热会把流量、内存与磁盘全吃满。 */
const warmed = {};            // 本会话已预热过的场景：同一个不重复拉
function warmScene(id){
  if(!id || !SCENES[id] || warmed[id] || videoBlocked[id]) return;
  if(!videoAllowed()) return;
  /* 只对 http(s) 预热。文件夹版双击打开是 file://，那里 fetch 会被 CORS 拦
     （origin null → 控制台报错，而本项目「零 console error」是硬口径），
     而且 file:// 下既没有 SW 也不存在网络等待，本来就不需要预热。
     云版 / App（Capacitor 的本地 http 服务器）才走下面这条。 */
  if(typeof location === "undefined" || location.protocol === "file:") return;
  warmed[id] = true;
  try{
    /* 消费响应体是必须的：不消费的话浏览器可能直接掐掉这次下载（白拉一趟），
       而 SW 那边也是靠 clone 的 body 被读取才真正写进 Cache Storage */
    fetch(VIDEO_DIR + id + ".mp4", {cache: "force-cache"})
      .then(r => (r && r.ok && r.arrayBuffer) ? r.arrayBuffer() : null)
      .catch(() => { warmed[id] = false; });   // 网络抖动：允许下次再试（404 会走 ok=false 分支，不重试）
  }catch(e){ warmed[id] = false; }             // fetch 不可用（老 WebView）：静默，退回原来的按需加载
}
function warmNeighbors(){
  clearTimeout(warmTimer);
  if(!active || !videoAllowed()) return;
  warmTimer = setTimeout(() => {
    if(!active) return;
    const i = SCENE_ORDER.indexOf(lastScene);
    if(i < 0) return;
    const n = SCENE_ORDER.length;
    warmScene(SCENE_ORDER[(i + 1) % n]);
    warmScene(SCENE_ORDER[(i - 1 + n) % n]);
  }, WARM_DELAY);
}

/* ---------- 场景（渐变不可插值 → 双槽位交叉淡入，沿用 §8c 的手法） ---------- */
function setScene(id, fade){
  id = SCENES[id] ? id : "mist";
  if(!parts) return;
  if(perfLite()) fade = false;    // 低端机：不叠交叉淡入层（渐变硬切，成本归零）
  if(fade && lastScene && lastScene !== id){
    const old = parts.scene.cloneNode(true);
    /* 只留背景渐变（2026-10-14）：两个 58vmax 的 blur(70px) 光斑与 .fs-fx 动态层
       在淡出的 780ms 里纯粹是白烧 GPU —— 它们本来被 has-video 压着，
       但克隆体会把动画重新跑起来。清空内部 = 交叉淡入只剩一层渐变，
       观感几乎无差别，成本几乎归零 */
    old.innerHTML = "";
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
   广播 view:dirty 是为了让番茄卡底部的场景色点条跟着高亮 —— 沉浸里换完再退出时它不是过期 DOM。
   2026-10-14 换景卡顿整改两处：
   ① 偏好用 setQuiet 落盘 —— 场景 id 不参与任何主题 token，没必要每次换景都跑整条 apply()
      （19 个行内变量清理 + applyWallpaper/paintBgMode）；settings:changed 照旧广播，云同步语义不变；
   ② 沉浸中不立刻广播 view:dirty —— 那时 #app 是 opacity:0，却会被 router.render() 整页重建
      （今日页/番茄卡的 DOM 全量重建）。先记账，退出沉浸时补刷一次（见 exit）。 */
function pick(id){
  if(!SCENES[id]) return;
  const put = (WB.theme && WB.theme.setQuiet) || (WB.theme && WB.theme.set);
  if(put) put.call(WB.theme, "pomoImmersiveScene", id);
  if(active){
    setScene(id, true);
    dirtyPending = true;
    warmNeighbors();        // 换完景顺手把新邻居预热上
  }else{
    WB.bus.emit("view:dirty");
  }
}
/* ← / → = 上一个 / 下一个场景，按 SCENE_ORDER 首尾循环。
   换景后把场景名浮一下：控件可能已自动隐藏，不提示就不知道换到了哪一支 */
function step(dir){
  /* 连发节流（2026-10-14）：键盘长按会以 30/s 重复触发，滑动/箭头连点也一样。
     不设闸门的话每次都要换视频源 + 交叉淡入 + 落盘 + 记账，串成队列 = 越按越卡 */
  const now = Date.now();
  if(now - lastStepTs < STEP_MIN_MS) return;
  lastStepTs = now;
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
  else if(act === "rotate"){ cycleOrientation(); wake(); }
}

/* ---------- 沉浸方向（横屏 / 竖屏） ----------
   auto → landscape → portrait 循环，偏好落盘（与 pomoImmersiveScene 同一套 th() 读取）。
   真正的锁定交给 WB.orientation：App 里是原生插件（Web 的 screen.orientation.lock()
   在 Android WebView 上实测被拒），网页版没有原生桥时能锁就锁、锁不了就只靠 CSS 布局适配 ——
   所以无论能不能锁，"横屏时就该是横屏的样子"这件事由样式保证 */
const ORIENT_MODES = ["auto", "landscape", "portrait"];
const ORIENT_LABEL = {auto: "跟随系统", landscape: "横屏", portrait: "竖屏"};
const ORIENT_GLYPH = {auto: "⟳", landscape: "▭", portrait: "▯"};
function currentOrientation(){
  const m = th().pomoOrientation;
  return ORIENT_MODES.indexOf(m) >= 0 ? m : "auto";
}
function applyOrientation(mode){
  if(WB.orientation){
    if(mode === "auto") WB.orientation.unlock();
    else WB.orientation.lock(mode);
  }
  paintRotateBtn();
}
function cycleOrientation(){
  const next = ORIENT_MODES[(ORIENT_MODES.indexOf(currentOrientation()) + 1) % ORIENT_MODES.length];
  WB.theme.set("pomoOrientation", next);
  applyOrientation(next);
  if(!WB.orientation) WB.ui.toast("沉浸方向偏好：" + ORIENT_LABEL[next] + "（当前环境不支持锁定，按内容自适应）");
  else WB.ui.toast("沉浸方向：" + ORIENT_LABEL[next]);
}
function paintRotateBtn(){
  if(!parts) return;
  const b = stage.querySelector('[data-act="rotate"]');
  if(!b) return;
  const m = currentOrientation();
  b.textContent = ORIENT_GLYPH[m];
  b.classList.toggle("is-off", m === "auto");
  b.title = "沉浸方向：" + ORIENT_LABEL[m] + "（点击切换）";
}
function onStageClick(e){
  /* 左右箭头 = 上一个 / 下一个场景（与 ← → 键、左右滑动走同一个出口 step()） */
  const arrow = e.target.closest(".fs-arrow");
  if(arrow){ step(arrow.dataset.act === "next" ? 1 : -1); return; }
  if(e.target.closest(".fs-tools, .fs-controls")) return;
  toggleChrome();
}

/* ---------- 左右滑动换景（移动端等价于桌面端的 ← / →） ----------
   #focus-stage 独占这道手势：js/15-gestures.js 的横滑切页在沉浸里已整体让位
   （immersiveBusy() 早退），两边不会抢。阈值 48px、且水平位移要明显大于垂直，
   否则会把"点一下切控件层""斜着滑"误判成换景 */
const SWIPE_MIN = 48, SWIPE_RATIO = 1.4, SWIPE_MAX_MS = 700;
let swipeOn = false, swipeX = 0, swipeY = 0, swipeT = 0;
function swipeStart(e){
  if(e.touches.length !== 1){ swipeOn = false; return; }
  swipeOn = true;
  swipeX = e.touches[0].clientX; swipeY = e.touches[0].clientY; swipeT = Date.now();
}
function swipeEnd(e){
  if(!swipeOn) return;
  swipeOn = false;
  if(!active || pickerShown) return;                    // 场景面板开着时，手势归它
  if(Date.now() - swipeT > SWIPE_MAX_MS) return;        // 太慢 = 拖拽 / 长按，不算滑动
  const t = e.changedTouches && e.changedTouches[0];
  if(!t) return;
  const dx = t.clientX - swipeX, dy = t.clientY - swipeY;
  if(Math.abs(dx) < SWIPE_MIN) return;
  if(Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return; // 更偏纵向 → 不是换景
  step(dx < 0 ? 1 : -1);                                // 左滑 = 下一个，与 → 同向
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
/* 进度色温：专注越往后场景的"特征光"越浓（0 → 0.28）；休息与待确认时退回 0。
   只写 CSS 变量，过渡本身在 .fs-tint 里声明（不绕过 no-motion 熔断） */
function paintWarmth(s, pct){
  const warm = (s.mode === "focus" && !s.needConfirm) ? Math.round(pct * WARMTH_MAX * 1000) / 1000 : 0;
  if(warm !== lastWarm){
    lastWarm = warm;
    stage.style.setProperty("--fs-warmth", String(warm));
  }
}
/* 秒级心跳专走这一条（2026-10-14）：只有「每秒真的会变」的四样 —— 数字 / 进度环 / 色温 / 标题。
   相位文案、控制条、今日番茄数、小花园、呼吸引导、声音按钮都是**状态变化**才需要的东西，
   原来全挂在每秒的 pomo:tick 上 —— todayPomos() 与 gardenStats() 每秒各去 parse 一遍
   pomoLog（store.get 是「每次读都 JSON.parse」的实现），在手机上就是纯烧 CPU。
   现在它们只在 render()（状态变化：开始/暂停/继续/切段/进入）里跑。 */
function renderTick(){
  if(!active || !parts) return;
  const s = session();
  if(!s){ exit(); return; }
  setTime(fmtClock(s.remainSec));
  const pct = WB.clamp(s.plannedSec ? 1 - s.remainSec / s.plannedSec : 0, 0, 1);
  if(ringFore) ringFore.style.strokeDashoffset = String(ringCirc * (1 - pct));
  paintWarmth(s, pct);
  titleSync();
}
function render(){
  if(!active || !parts) return;
  const s = session();
  if(!s){ exit(); return; }             // 放弃/结束时状态被清空 → 自动退出
  const focus = s.mode === "focus";
  setTime(fmtClock(s.remainSec));
  const pct = WB.clamp(s.plannedSec ? 1 - s.remainSec / s.plannedSec : 0, 0, 1);
  if(ringFore) ringFore.style.strokeDashoffset = String(ringCirc * (1 - pct));
  paintWarmth(s, pct);
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
  dirtyPending = false;                // 上次退出的补刷标记不许跨会话残留
  lastStepTs = 0;
  build();
  const my = gen;
  /* 性能分档（低端机）：CSS 侧降 blur / 停动态层，setScene 侧关交叉淡入 */
  stage.classList.toggle("fs-lite", perfLite());
  /* 主题/场景/尺寸先落地，避免第一帧闪错配色 */
  setScene(sceneId(), false);
  buildRing();
  applyOrientation(currentOrientation());   // 沿用上次的横/竖屏偏好（内含按钮图标刷新）
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
  warmNeighbors();                     // 预热前后各 1 支场景视频（见 warmScene）
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
  clearTimeout(warmTimer); warmTimer = null;    // 退出了就别再吃网络去预热
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
  if(WB.orientation) WB.orientation.unlock();   // 退出沉浸即交还方向控制权，别让主界面也被锁着
  mediaOff();
  document.title = titleBefore || document.title;
  soundSync(700);
  /* 沉浸期间换过景 → 现在补刷一次视图（沉浸中刻意不刷，见 pick）。
     此刻 #app 正在 immersive-fade 的淡入里，重建正是它该刷新的时候 */
  if(dirtyPending){ dirtyPending = false; WB.bus.emit("view:dirty"); }
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
  if(active){ renderTick(); mediaPos(); }   // 秒级只走轻量路径（见 renderTick）
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

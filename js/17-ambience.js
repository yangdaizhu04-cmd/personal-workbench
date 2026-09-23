/* 17-ambience.js —— 氛围引擎：按时段自动编排「场景 / 音景 / 主题」
   来源：第五轮方案主线 🅐（2026-09-23）。工作台已经攒了 12 套沉浸场景、12 支循环视频、
   7 路音源、双主题，但它们彼此不知道对方存在，全靠手动开关 —— 本层只做「编排」，
   不新增任何素材、不新增依赖。

   工程约束（改这里前先读这段）：
   · **默认关闭**（ambienceOn=false）：编排在位但一次都不主动改用户的界面，设置页确认后才生效
   · **只在时段切换时应用一次**（lastSeg 门闩），不每秒重写 ——
     用户在段内手动改的主题 / 场景 / 声音不会被引擎抢回去
   · **音景受浏览器自动播放策略限制**：AudioContext 没被用户手势解锁前不起播（也不假装起了），
     此时只切场景与主题；等解锁后的下一次时段切换再补上音景（设置页有明确说明）
   · **番茄沉浸层的语义一个字不动**：它自己读 pomoImmersiveScene、自己管切换与提示；
     本层只是在时段切换时替用户把偏好改掉（走 WB.immersive.pick，与手动选场景同一条路）
   · 设置键全部落在 settings 里（ambienceOn / ambiencePlan / ambienceAsked），
     云端与 WebDAV 同步白名单天然覆盖，不需要额外改同步层 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* 四个时段：分界小时固定（晨 6 / 昼 11 / 暮 17 / 夜 21），内容可整体自定义。
   不把分界做成可配置 —— 那是"作息表"，不是"氛围"；用户想改的是搭配，不是几点算清晨 */
const SEGS = [
  {id: "morning", name: "晨", from: 6,  to: 11},
  {id: "day",     name: "昼", from: 11, to: 17},
  {id: "dusk",    name: "暮", from: 17, to: 21},
  {id: "night",   name: "夜", from: 21, to: 6},
];
/* 内置默认编排：跟着光线走 —— 早上雾里落雨、白天深海白噪、傍晚壁炉暖光、夜里星野低吟 */
const DEFAULT_PLAN = {
  morning: {scene: "mist",  sound: "rain",  theme: "light"},
  day:     {scene: "deep",  sound: "white", theme: "light"},
  dusk:    {scene: "ember", sound: "fire",  theme: "dark"},
  night:   {scene: "star",  sound: "lofi",  theme: "dark"},
};
const OFF = "off";            // 场景=不干预 / 音景=无
const SOUND_KEYS = [["rain", "雨声"], ["waves", "海浪"], ["white", "白噪"], ["fire", "篝火"],
  ["piano", "钢琴"], ["pad", "晨间氛围"], ["lofi", "Lo-Fi 心流"]];

function pad(n){ return String(n).padStart(2, "0"); }
function timeLabel(seg){ return pad(seg.from) + ":00–" + pad(seg.to) + ":00"; }

/* 用户编排（浅合并到默认之上）：只覆盖用户动过的那几格，新增时段自动拿到默认值 */
function plan(){
  const raw = WB.theme.get("ambiencePlan") || {};
  const out = {};
  SEGS.forEach(s => { out[s.id] = Object.assign({}, DEFAULT_PLAN[s.id], raw[s.id] || {}); });
  return out;
}
function currentSeg(d){
  const now = d || new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  for(const s of SEGS){
    if(s.from < s.to){ if(h >= s.from && h < s.to) return s; }
    else if(h >= s.from || h < s.to) return s;   // 跨零点的「夜」
  }
  return SEGS[0];
}
function cfgOf(id){ return plan()[id]; }
function soundReady(){ return !!(WB.sound && WB.sound.unlocked && WB.sound.unlocked()); }

let lastSeg = "";             // 已应用过的时段：同一个时段内绝不重复动手

/* 应用一个时段。force=true 时无视门闩（启用开关、点「立即应用」、跨日回来看一眼）。
   返回 null = 引擎没开；否则返回本次真正做了什么（供设置页与探针核对） */
function apply(force){
  if(!WB.theme.get("ambienceOn")) return null;
  const seg = currentSeg();
  if(!force && seg.id === lastSeg) return null;
  lastSeg = seg.id;
  const cfg = cfgOf(seg.id);
  const done = {seg: seg.id, scene: "", theme: "", sound: "", soundBlocked: false};

  /* 场景：与用户在沉浸里点场景面板是同一条路（pick 会落偏好并在沉浸中就位） */
  if(cfg.scene && cfg.scene !== OFF && WB.immersive && WB.immersive.pick &&
     WB.immersive.scenes && WB.immersive.scenes[cfg.scene]){
    WB.immersive.pick(cfg.scene);
    done.scene = cfg.scene;
  }
  /* 主题：值相同就不写，免得白发一轮 settings:changed 与 700ms 交叉过渡 */
  if(cfg.theme && WB.theme.get("theme") !== cfg.theme){
    WB.theme.set("theme", cfg.theme);
    done.theme = cfg.theme;
  }
  /* 音景：选「无」= 本时段不放（也要把引擎自己放起来的那一路停掉，否则「无」形同虚设）。
     没解锁就只记账，不起播（浏览器不允许无手势自动播放，静默失败会让「切了却没声音」无从解释） */
  if(WB.sound && WB.sound.setCombo){
    const want = (cfg.sound && cfg.sound !== OFF) ? cfg.sound : null;
    if(soundReady()){
      WB.sound.setCombo(want);
      done.sound = want || OFF;
    }else{
      done.soundBlocked = !!want;
    }
  }
  return done;
}

/* 改某一格：就地重算 plan 落库。改的若是**当前**时段，清门闩让下一次检查重新对齐；
   改的是别的时段就什么都不做（改"夜"不该在中午打断你） */
function setSeg(id, patch){
  if(!SEGS.some(s => s.id === id)) return;
  const raw = WB.store.get("settings", {}).ambiencePlan || {};
  const next = Object.assign({}, raw);
  next[id] = Object.assign({}, DEFAULT_PLAN[id], raw[id] || {}, patch);
  WB.theme.set("ambiencePlan", next);
  if(id === currentSeg().id) lastSeg = "";
}
function resetPlan(){
  WB.theme.set("ambiencePlan", {});
  lastSeg = "";
}

/* 一句话描述某时段（设置页与提示复用，避免两处各写一份文案） */
function describe(id){
  const c = cfgOf(id);
  const scene = (c.scene === OFF || !WB.immersive) ? "不干预"
    : (WB.immersive.scenes[c.scene] || c.scene);
  const sound = c.sound === OFF ? "无"
    : ((SOUND_KEYS.find(k => k[0] === c.sound) || [c.sound, c.sound])[1]);
  const theme = {light: "晨雾奶油", dark: "夜雾", auto: "跟随系统"}[c.theme] || c.theme;
  return scene + " · " + sound + " · " + theme;
}

function init(){
  if(!WB.theme.get("ambienceOn")) return;
  /* 延后 1.4s：避开入场雾开与首屏卡片动画，也让 immersive/sound 两个模块都挂好 */
  setTimeout(() => apply(true), 1400);
  setInterval(() => apply(), 60000);
  /* 休眠/切走回来最容易跨过时段分界：可见即检查一次（门闩保证不会重复动手） */
  document.addEventListener("visibilitychange", () => { if(!document.hidden) apply(); });
  addEventListener("focus", () => apply());
}

/* 开关被打开（设置页 / 导入备份 / 云端拉取）时立刻对齐一次 —— 派生状态不挂在具体入口上 */
WB.bus.on("settings:changed", patch => {
  if(patch && patch.key === "ambienceOn" && patch.val) apply(true);
});

WB.ambience = {
  SEGS, DEFAULT_PLAN, SOUND_KEYS, OFF,
  plan, cfgOf, currentSeg, timeLabel, describe, apply, setSeg, resetPlan, init, soundReady,
  enabled(){ return !!WB.theme.get("ambienceOn"); },
};
})();

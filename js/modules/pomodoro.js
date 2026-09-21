/* modules/pomodoro.js —— 番茄钟：真实时间戳计时（关页面照走）、三件套提醒、绑定待办/技能、小花园 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;
const pomoLog = WB.collection("pomoLog");
const PRESETS = [
  {label: "25+5", focus: 25, rest: 5},
  {label: "50+10", focus: 50, rest: 10},
  {label: "90+20", focus: 90, rest: 20},
  {label: "自定义", focus: 0, rest: 0},
];

/* ---------- 状态（时间戳制：elapsed = accum + now-resumeTs） ---------- */
function stateRaw(){ return WB.store.get("pomodoro", null); }
function setState(s){ WB.store.set("pomodoro", s); }
function state(){
  const s = stateRaw();
  if(!s) return null;
  const elapsed = s.accumMs / 1000 + (s.resumeTs ? (Date.now() - s.resumeTs) / 1000 : 0);
  return Object.assign({}, s, {elapsedSec: Math.floor(elapsed), remainSec: Math.max(0, Math.ceil(s.plannedSec - elapsed))});
}
function isFocusing(){
  const s = stateRaw();
  return !!(s && s.running && s.mode === "focus");
}
/* 球体相位（ThreeUI island）：idle/celebrate/focus-running/focus-paused/rest-running/rest-paused */
function emitPhase(){
  const s = stateRaw();
  let phase = "idle";
  if(s){
    if(s.needConfirm) phase = "celebrate";
    else if(s.running) phase = s.mode + "-running";
    else phase = s.mode + "-paused";
  }
  WB.bus.emit("pomo:phase", {phase});
}
/* 持久宿主：模块每次渲染重新搬进计时卡，避免 router 重绘时 React 根被销毁 */
let orbHost = null;
function orbHostEl(){
  if(!orbHost) orbHost = document.getElementById("focus-orb") || el("div", {id: "focus-orb", "data-state": "idle"});
  return orbHost;
}
function begin(mode, plannedMin){
  setState({mode, plannedSec: plannedMin * 60, accumMs: 0, resumeTs: Date.now(), running: true,
    needConfirm: false, bindType: curBind.type, bindId: curBind.id, bindTitle: curBind.title,
    startedAt: Date.now()});
  tickStart();
  emitPhase();
  if(mode === "focus"){
    WB.bus.emit("pomo:start"); // 声音面板自动恢复上次组合
    if(WB.router.nav() === "today") WB.router.render(); // 内容类卡片立即淡出
  }
  /* 自动进沉浸：默认关闭（设置 → 番茄钟与提醒 → 开始专注时自动进入）。
     延迟交给浏览器先跑完点击反馈；仍在用户激活窗口内，全屏请求有效 */
  const th = WB.theme.all();
  if(mode === "focus" && WB.immersive && th.pomoImmersive !== false && th.pomoImmersiveAuto){
    setTimeout(() => { if(isFocusing() && !WB.immersive.isActive()) WB.immersive.enter({auto: true}); }, 160);
  }
}
function pause(){
  const s = stateRaw(); if(!s || !s.running) return;
  s.accumMs += Date.now() - s.resumeTs; s.resumeTs = null; s.running = false;
  setState(s); tickStop(); emitPhase();
}
function resume(){
  const s = stateRaw(); if(!s || s.running) return;
  s.resumeTs = Date.now(); s.running = true; s.needConfirm = false;
  setState(s); tickStart(); emitPhase();
}
function giveUp(){
  const s = stateRaw(); if(!s) return;
  const elapsedMin = Math.round(state().elapsedSec / 60);
  if(s.mode === "focus" && elapsedMin >= 1){
    pomoLog.add({date: WB.bizDate(), mode: "focus", status: "quit", minutes: elapsedMin,
      bindType: s.bindType, bindId: s.bindId, bindTitle: s.bindTitle, ts: Date.now()});
    WB.ui.toast("小苗蔫了一下…休息一下再来 🌱", "sad");
  }else{
    WB.ui.toast("已取消");
  }
  setState(null); tickStop(); emitPhase();
  WB.bus.emit("pomo:finish", {mode: s.mode, status: "quit"});
  WB.router.render();
}
function finish(){
  const s = stateRaw(); if(!s) return;
  const minutes = Math.round(s.plannedSec / 60);
  pomoLog.add({date: WB.bizDate(), mode: s.mode, status: "done", minutes,
    bindType: s.bindType, bindId: s.bindId, bindTitle: s.bindTitle, ts: Date.now()});
  s.running = false; s.accumMs = s.plannedSec * 1000; s.resumeTs = null;
  s.needConfirm = true; s.nextMode = s.mode === "focus" ? "rest" : "focus";
  setState(s); tickStop(); emitPhase();
  notifyAll(s.mode);
  /* 声音面板监听 pomo:finish 做淡出后静音，但此前全项目无人 emit（死订阅） */
  WB.bus.emit("pomo:finish", {mode: s.mode, status: "done"});
  if(WB.badgeCheck) WB.badgeCheck();
}
function confirmNext(){
  const s = stateRaw(); if(!s || !s.needConfirm) return;
  const settings = WB.theme.all();
  const minutes = s.nextMode === "focus" ? settings.pomodoroFocus : settings.pomodoroRest;
  begin(s.nextMode, minutes);
  WB.router.render();
}
function stopAndClear(){
  setState(null); tickStop(); emitPhase();
  WB.bus.emit("pomo:finish", {mode: "stop", status: "stop"});
  WB.router.render();
}

/* ---------- 提醒三件套 ---------- */
let titleTimer = null;
const baseTitle = document.title;
/* 停掉标题闪烁（函数声明，供 setTimeout 提前引用；同时把 titleTimer 归零，
   沉浸层靠 titleFlashing() 判断要不要接管 document.title） */
function stopFlash(){
  clearInterval(titleTimer);
  titleTimer = null;
  document.title = baseTitle;
}
function notifyAll(mode){
  const st = WB.theme.all();
  const isFocusEnd = mode === "focus";
  if(st.pomoSound) WB.ui.chime(isFocusEnd ? "big" : "done");
  // 沉浸层自己会给中央提示，别再叠一层全屏 flash
  if(st.pomoFlash && !(WB.immersive && WB.immersive.isActive())) flashOverlay(isFocusEnd);
  if(st.pomoTitle){
    let on = false;
    const text = isFocusEnd ? "🍅 专注完成！休息一下" : "⏰ 休息结束，回来专注";
    clearInterval(titleTimer);
    titleTimer = setInterval(() => {
      document.title = on ? baseTitle : text; on = !on;
    }, 900);
    setTimeout(stopFlash, 12000);
    const stop = () => { stopFlash(); removeEventListener("click", stop); };
    addEventListener("click", stop, {once: true});
  }
  WB.notify(isFocusEnd ? "🍅 专注完成" : "🌱 休息结束", isFocusEnd ? "休息 " + WB.theme.get("pomodoroRest") + " 分钟吧" : "准备好开始下一轮专注了吗");
}
function flashOverlay(isFocusEnd){
  // 层级/模糊全部走 CSS 变量与类，避免「CSS 里查不到的 z-index / 内联模糊值」
  const div = el("div", {class: "pomo-flash"});
  div.style.opacity = "0";
  div.innerHTML = '<div style="font-size:54px">' + (isFocusEnd ? "🍅" : "🌱") + "</div>" +
    '<div style="font-size:22px;font-weight:600">' + (isFocusEnd ? "专注完成！" : "休息结束") + "</div>" +
    '<div class="muted">' + (isFocusEnd ? "去喝口水，看看远处" : "深呼吸，我们开始下一轮") + "</div>";
  document.body.appendChild(div);
  requestAnimationFrame(() => { div.style.opacity = "1"; });
  setTimeout(() => {
    div.style.opacity = "0";
    setTimeout(() => div.remove(), 700);
  }, 2600);
}

/* ---------- 计时心跳 ---------- */
let ticker = null;
function tickStart(){
  tickStop();
  ticker = setInterval(() => {
    const s = state();
    if(!s || !s.running){ tickStop(); return; }
    if(s.remainSec <= 0) finish();
    else {
      const pct = 1 - s.remainSec / s.plannedSec;
      const ringEl = document.getElementById("pomo-ring");
      if(ringEl && ringEl.__update) ringEl.__update(pct, s.remainSec);
      /* 广播给沉浸层：秒级粒度（1s 一次），环与数字都靠它推进 */
      WB.bus.emit("pomo:tick", {remainSec: s.remainSec, elapsedSec: s.elapsedSec, pct: pct,
        mode: s.mode, plannedSec: s.plannedSec, running: s.running});
    }
  }, 1000);
}
function tickStop(){ if(ticker){ clearInterval(ticker); ticker = null; } }
function fmtRemain(sec){
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/* ---------- 绑定选择 ---------- */
const curBind = {type: "none", id: "", title: ""};
function bindPicker(){
  const box = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px"}});
  const todosToday = WB.store.get("todos", []).filter(t => !t.done && t.date === WB.bizDate());
  const skills = WB.store.get("skills", []).filter(s => !s.archived);
  const paint = () => {
    box.innerHTML = "";
    const mk = (label, val) => {
      const on = (curBind.type + ":" + curBind.id) === val;
      return el("button", {class: "chip clickable" + (on ? "" : " plain"), text: label,
        onclick: () => {
          if(val === "none"){ curBind.type = "none"; curBind.id = ""; curBind.title = ""; }
          else{
            const [t, id] = val.split(":");
            if(t === "todo"){ const x = todosToday.find(x => x.id === id); curBind.type = "todo"; curBind.id = id; curBind.title = x ? x.title : ""; }
            if(t === "skill"){ const x = skills.find(x => x.id === id); curBind.type = "skill"; curBind.id = id; curBind.title = x ? x.name : ""; }
          }
          paint();
        }});
    };
    box.appendChild(mk("🎯 不绑定", "none"));
    todosToday.slice(0, 6).forEach(t => box.appendChild(mk("☑ " + t.title.slice(0, 10), "todo:" + t.id)));
    skills.slice(0, 4).forEach(s => box.appendChild(mk("⚡ " + s.name.slice(0, 10), "skill:" + s.id)));
  };
  paint();
  return box;
}

/* ---------- 小花园（由 pomoLog 推导） ---------- */
function gardenView(){
  const logs = pomoLog.all().slice(-28).reverse(); // 最近的在前
  const wrap = el("div", {class: "row", style: {flexWrap: "wrap", gap: "10px", padding: "6px 0"}});
  if(!logs.length){
    wrap.appendChild(el("span", {class: "small faint", text: "每完成一个番茄，花园里就长出一株小苗 🌱 每 4 个开一朵花 🌸 放弃会让小苗蔫掉…"}));
    return wrap;
  }
  let focusCount = logs.filter(l => l.status === "done" && l.mode === "focus").length;
  logs.forEach(l => {
    let emoji;
    if(l.status === "quit") emoji = "🥀";
    else if(l.mode === "focus"){
      const n = focusCount;
      emoji = n % 4 === 0 ? "🌸" : l.minutes >= 50 ? "🌳" : l.minutes >= 25 ? "🌿" : "🌱";
      focusCount--;
    }else emoji = "💧";
    wrap.appendChild(el("span", {title: (l.bindTitle || "专注") + " · " + l.minutes + " 分钟 · " + (l.status === "done" ? "完成" : "中断"),
      style: {fontSize: "24px", transition: "transform .2s"}, text: emoji}));
  });
  return wrap;
}
function gardenStats(){
  const logs = pomoLog.all();
  const done = logs.filter(l => l.status === "done" && l.mode === "focus");
  return {
    pomos: done.length,
    minutes: done.reduce((s, l) => s + l.minutes, 0),
    flowers: Math.floor(done.length / 4),
    quits: logs.filter(l => l.status === "quit").length,
  };
}

/* ---------- 模块 ---------- */
WB.registerModule({
  id: "pomodoro",
  title: "番茄钟",
  icon: "timer",
  sub: function(){ const g = gardenStats(); return "累计 " + g.pomos + " 个番茄 · " + Math.round(g.minutes / 60 * 10) / 10 + " 小时"; },

  render(view){
    const settings = WB.theme.all();
    const s = state();

    /* 计时卡 */
    const timerCard = el("div", {class: "card", style: {textAlign: "center", marginBottom: "14px"}});
    if(!s){
      /* 预设选择 */
      let mode = "focus";
      const presetSeg = el("div", {class: "seg", style: {marginBottom: "14px"}});
      const customRow = el("div", {class: "row", style: {justifyContent: "center", gap: "8px", marginBottom: "12px", display: "none"}});
      const fIn = el("input", {type: "number", class: "input", value: settings.pomodoroFocus, min: 1, max: 180, style: {width: "80px", textAlign: "center"}});
      const rIn = el("input", {type: "number", class: "input", value: settings.pomodoroRest, min: 1, max: 60, style: {width: "80px", textAlign: "center"}});
      customRow.append(el("span", {class: "small muted", text: "专注"}), fIn, el("span", {class: "small muted", text: "分 + 休息"}), rIn, el("span", {class: "small muted", text: "分"}));
      let curPreset = "25+5";
      PRESETS.forEach(p => presetSeg.appendChild(el("button", {class: p.label === curPreset ? "on" : "", text: p.label, dataset: {v: p.label},
        onclick: () => {
          curPreset = p.label;
          presetSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === p.label));
          customRow.style.display = p.label === "自定义" ? "flex" : "none";
        }})));
      timerCard.appendChild(presetSeg);
      timerCard.appendChild(customRow);
      timerCard.appendChild(el("div", {style: {fontSize: "52px", fontWeight: "600", padding: "10px 0"}, text: "🍅"}));
      timerCard.appendChild(el("div", {class: "muted", style: {marginBottom: "14px"}, text: "选好时长与绑定，开始一段不被打扰的时间"}));
      timerCard.appendChild(el("div", {class: "small muted", style: {marginBottom: "6px"}, text: "专注前绑定（自动累计时长与时间去向）："}));
      timerCard.appendChild(bindPicker());
      const startBtn = el("button", {class: "btn primary", style: {marginTop: "16px", fontSize: "16px", padding: "10px 30px"},
        text: "▶ 开始专注",
        onclick: () => {
          let fMin, rMin;
          if(curPreset === "自定义"){
            fMin = WB.clamp(parseInt(fIn.value) || 25, 1, 180);
            rMin = WB.clamp(parseInt(rIn.value) || 5, 1, 60);
          }else{
            const p = PRESETS.find(x => x.label === curPreset);
            fMin = p.focus; rMin = p.rest;
          }
          WB.theme.merge({pomodoroFocus: fMin, pomodoroRest: rMin});
          begin("focus", fMin);
          WB.router.render();
        }});
      timerCard.appendChild(startBtn);
    }else{
      /* 进行中 / 待确认 */
      const st = state();
      const ringEl = WB.ui.ring(0, 190, 9);
      ringEl.id = "pomo-ring";
      ringEl.__update = (pct, remainSec) => {
        const fg = ringEl.querySelector(".ring-fg");
        const c = parseFloat(fg.getAttribute("stroke-dasharray"));
        fg.style.strokeDashoffset = c * (1 - WB.clamp(pct, 0, 1));
        ringEl.querySelector(".ring-label").textContent = fmtRemain(remainSec != null ? remainSec : Math.ceil(st.plannedSec * (1 - WB.clamp(pct, 0, 1))));
      };
      ringEl.querySelector(".ring-label").style.fontSize = "26px";
      ringEl.querySelector(".ring-label").style.fontWeight = "600";
      ringEl.__update(1 - st.remainSec / st.plannedSec, st.remainSec);
      const timeWrap = el("div", {class: "center pomo-orb-stage", style: {position: "relative", padding: "6px 0"}},
        orbHostEl(), ringEl);
      timerCard.appendChild(timeWrap);
      WB.bus.emit("pomo:orb-attach"); // 宿主已搬回 DOM，让 island 重新对齐相位

      timerCard.appendChild(el("div", {class: "muted", style: {marginBottom: "6px"}},
        st.mode === "focus" ? "🍅 专注中" : "🌱 休息中",
        st.bindTitle ? " · " + st.bindTitle : "",
        st.running ? "" : "（已暂停）"));
      if(!st.running && !st.needConfirm)
        timerCard.appendChild(el("div", {class: "small faint", style: {marginBottom: "8px"}, text: "计时基于真实时间，切走/最小化也在走"}));

      const btns = el("div", {class: "row", style: {justifyContent: "center", gap: "10px", marginTop: "12px"}});
      // 沉浸入口：全屏专注模式（细线环 + 巨型数字 + 环境音联动，快捷键 F）
      if(WB.immersive && settings.pomoImmersive !== false)
        btns.appendChild(el("button", {class: "btn", html: icon("timer", 16) + "<span>沉浸</span>",
          title: "沉浸专注（F）", onclick: () => WB.immersive.enter()}));
      if(st.needConfirm){
        timerCard.appendChild(el("div", {class: "chip", style: {fontSize: "14px", padding: "8px 16px"},
          text: st.nextMode === "rest" ? "一段专注完成了！确认后才开始休息" : "休息结束，确认后开始下一轮专注"}));
        btns.appendChild(el("button", {class: "btn primary", text: st.nextMode === "rest" ? "☕ 开始休息" : "▶ 开始下一轮",
          onclick: () => { confirmNext(); }}));
        btns.appendChild(el("button", {class: "btn ghost", text: "先到这",
          onclick: () => { stopAndClear(); }}));
      }else if(st.running){
        btns.appendChild(el("button", {class: "btn", text: "⏸ 暂停", onclick: () => { pause(); WB.router.render(); }}));
        btns.appendChild(el("button", {class: "btn danger", text: "放弃",
          onclick: async () => {
            const ok = await WB.ui.confirmBox("中途放弃的话，小花园里的小苗会蔫掉 🥀 确定放弃？", {danger: true, okLabel: "放弃"});
            if(ok) giveUp();
          }}));
      }else{
        btns.appendChild(el("button", {class: "btn primary", text: "▶ 继续", onclick: () => { resume(); WB.router.render(); }}));
        btns.appendChild(el("button", {class: "btn ghost", text: "放弃", onclick: () => giveUp()}));
      }
      timerCard.appendChild(btns);
      // 启动心跳（若在跑）
      if(st.running) tickStart();
    }
    view.appendChild(timerCard);

    /* 双栏：小花园 + 声音面板 */
    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    const garden = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("sprout", 18) + "<span>小花园</span><span class='card-sub'>" +
        (() => { const g = gardenStats(); return g.pomos + " 个番茄 · " + g.flowers + " 朵花 · 中断 " + g.quits + " 次"; })() + "</span>"}),
      gardenView());
    grid.appendChild(garden);
    const soundCard = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("music", 18) + "<span>声音面板</span><span class='card-sub'>四源混合 · 空格播放/暂停</span>"}));
    if(WB.sound && WB.sound.renderPanel) WB.sound.renderPanel(soundCard);
    grid.appendChild(soundCard);
    view.appendChild(grid);

    /* 今日专注记录 */
    const today = WB.bizDate();
    const todays = pomoLog.all().filter(l => l.date === today).reverse();
    if(todays.length){
      const logCard = el("div", {class: "card", style: {marginTop: "14px"}},
        el("div", {class: "card-title", html: icon("clock", 18) + "<span>今日专注记录</span><span class='card-sub'>" + todays.length + " 条</span>"}));
      const list = el("div", {class: "list"});
      todays.slice(0, 8).forEach(l => {
        list.appendChild(el("div", {class: "list-row small"},
          el("span", {text: l.status === "done" ? (l.mode === "focus" ? "🍅" : "💧") : "🥀"}),
          el("span", {class: "grow ellipsis", text: l.bindTitle || (l.mode === "focus" ? "专注" : "休息")}),
          el("span", {class: "faint", text: l.minutes + " 分钟"}),
          el("span", {class: "faint", text: WB.fmtTime(l.ts)})));
      });
      logCard.appendChild(list);
      view.appendChild(logCard);
    }
  },
});

/* 恢复：启动时若有进行中的计时则恢复心跳 */
setTimeout(() => {
  const s = stateRaw();
  if(s && s.running) tickStart();
  // 若离开期间已完成
  const st = state();
  if(st && st.running && st.remainSec <= 0) finish();
  else emitPhase();
}, 800);

/* finish / stopAndClear 原先没导出：沉浸层要「完成本段 / 先到这」两个动作，必须补上 */
WB.pomodoro = {state, isFocusing, begin, pause, resume, giveUp, confirmNext, gardenStats,
  finish, stopAndClear,
  titleFlashing(){ return !!titleTimer; },
  toggleSound(){
    if(WB.sound && WB.sound.toggle) WB.sound.toggle();
  }};
})();

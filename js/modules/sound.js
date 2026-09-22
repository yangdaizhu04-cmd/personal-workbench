/* modules/sound.js —— 声音面板：真实录音(本地 URL 加载) / 合成兜底 / 本地音乐(IndexedDB) / 我的音频库
   七路音源：雨声/海浪/篝火/钢琴/白噪/晨间氛围/Lo-Fi。前四路 2026-09-22 换入 pixel-town 项目的
   Pixabay 录音（Content License：免费商用、免署名），后三路仍为 CC0（OpenGameArt）；
   文件 URL 加载、不内嵌，断网/文件缺失时自动回落 WebAudio 合成；多路混合、独立音量 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;

let ctx = null;
function ac(){
  if(!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    ctx = new AC();
  }
  if(ctx.state === "suspended") ctx.resume();
  return ctx;
}
function master(){ const c = ac(); return c ? c._wbMaster : null; }
function ensureMaster(){
  const c = ac(); if(!c) return null;
  if(!c._wbMaster){
    const g = c.createGain();
    g.gain.value = 1;
    g.connect(c.destination);
    c._wbMaster = g;
  }
  return c._wbMaster;
}

/* ---------- 偏好 ---------- */
const DEF = {
  active: {},                    // {rain:true, white:false, fire:false, piano:false, pad:false, lofi:false, local:false, url:false}
  vol: {rain:.5, waves:.45, white:.4, fire:.5, piano:.5, pad:.45, lofi:.5, local:.8, url:.8, master:.9},
  localMode: "order", urlId: "",
};
function prefs(){ return Object.assign({}, DEF, WB.store.get("soundPrefs", {})); }
function setPrefs(p){ WB.store.set("soundPrefs", p); }

/* ---------- 噪声源工具 ---------- */
function noiseBuffer(c, brown){
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for(let i = 0; i < len; i++){
    const w = Math.random() * 2 - 1;
    if(brown){ last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}
function loopNoise(c, {brown, filterType, freq, q}){
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, brown);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = filterType || "lowpass"; f.frequency.value = freq || 1000; if(q) f.Q.value = q;
  const g = c.createGain(); g.gain.value = 0;
  src.connect(f).connect(g);
  src.start();
  return {node: g, src};
}

/* ---------- 白噪三路（合成） ---------- */
const makers = {
  rain(c, out){
    const n = loopNoise(c, {brown: false, filterType: "lowpass", freq: 1400});
    const hi = loopNoise(c, {brown: false, filterType: "highpass", freq: 4000});
    hi.node.gain.value = .12;
    n.node.connect(out);
    hi.node.connect(out);
    return {stop(){ try{ n.src.stop(); hi.src.stop(); }catch(e){} }};
  },
  white(c, out){
    const n = loopNoise(c, {brown: false, filterType: "highpass", freq: 40});
    n.node.gain.value = .55; n.node.connect(out);
    return {stop(){ try{ n.src.stop(); }catch(e){} }};
  },
  fire(c, out){
    const n = loopNoise(c, {brown: true, filterType: "lowpass", freq: 380});
    n.node.gain.value = .8; n.node.connect(out);
    // 随机噼啪
    const timer = setInterval(() => {
      if(Math.random() < .55){
        const b = c.createBufferSource();
        b.buffer = noiseBuffer(c, false);
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800 + Math.random() * 2400; bp.Q.value = 8;
        const g = c.createGain();
        const t = c.currentTime;
        g.gain.setValueAtTime(.0001, t);
        g.gain.exponentialRampToValueAtTime(.12 + Math.random() * .2, t + .012);
        g.gain.exponentialRampToValueAtTime(.0001, t + .1 + Math.random() * .12);
        b.connect(bp).connect(g).connect(out);
        b.start(t); b.stop(t + .35);
      }
    }, 160);
    return {stop(){ try{ n.src.stop(); }catch(e){} clearInterval(timer); }};
  },
  waves(c, out){ // 海浪：布朗噪低通打底 + LFO 缓慢起伏模拟浪涌 + 高频浪花
    const n = loopNoise(c, {brown: true, filterType: "lowpass", freq: 650});
    const g = c.createGain(); g.gain.value = .7;
    n.node.connect(g).connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = .09; // 约 11s 一轮浪涌
    const lg = c.createGain(); lg.gain.value = .3;
    lfo.connect(lg).connect(g.gain); lfo.start();
    const foam = loopNoise(c, {brown: false, filterType: "highpass", freq: 2500});
    const fg = c.createGain(); fg.gain.value = .05;
    foam.node.connect(fg).connect(out);
    return {stop(){ try{ n.src.stop(); foam.src.stop(); lfo.stop(); }catch(e){} }};
  },
};

/* ---------- 真实录音音源（来源与处理见 vendor/audio/README.md；文件 URL 加载，不内嵌） ---------- */
const REAL_SRC = {
  rain: "vendor/audio/rain.ogg",
  waves: "vendor/audio/waves.ogg",
  fire: "vendor/audio/fire.ogg",
  white: "vendor/audio/white.ogg",
  piano: "vendor/audio/piano.ogg",
  pad: "vendor/audio/pad.ogg",
  lofi: "vendor/audio/lofi.ogg",
};
const realEls = {};    // key -> HTMLAudioElement（跨次播放复用，浏览器自缓存）
const realState = {};  // key -> "loading" | "real" | "synth"
const genTok = {};     // 每路启动代际：停止/重启后使未完成的加载作废
const synthWarned = {};

function realVolume(key){
  const p = prefs();
  return clamp01((p.vol[key] != null ? p.vol[key] : .5) * (p.vol.master != null ? p.vol.master : .9));
}
function startReal(key){
  realState[key] = "loading";
  refreshPanel();
  return new Promise(resolve => {
    let a = realEls[key];
    if(!a){
      a = realEls[key] = new Audio();
      a.loop = true;
      a.preload = "auto";
      a.src = REAL_SRC[key];
    }
    let settled = false;
    const finish = ok => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      realState[key] = ok ? "real" : "synth";
      resolve(ok ? a : null);
    };
    const timer = setTimeout(() => finish(a.readyState >= 3), 4000);
    a.addEventListener("canplaythrough", () => finish(true), {once:true});
    a.addEventListener("error", () => finish(false), {once:true});
    try{ a.load(); }catch(e){ finish(false); }
  });
}
function realFallback(key, myTok){
  if(genTok[key] !== myTok || !prefs().active[key]) return;
  if(!synthWarned[key]){
    synthWarned[key] = true;
    const meta = SRC_META.find(m => m[0] === key);
    WB.ui.toast((meta ? meta[1] : key) + "录音文件没找到，先用合成音源", "warn");
  }
  const c = ac(); if(!c) return;
  const out = srcGain(key);
  const inst = makers[key](c, out);
  running[key] = {stop(){ try{ inst.stop(); out.disconnect(); }catch(e){} }, out};
  realState[key] = "synth";
  refreshPanel();
}

/* ---------- 生成式专注音乐 ---------- */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33]; // C 五声
function note(c, out, freq, t, dur, vol, type){
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + .02);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + .05);
}
makers.piano = function(c, out){ // 雨夜钢琴：雨声 + 五声音阶随机钢琴 + 回声
  const rain = makers.rain(c, out);
  const delay = c.createDelay(1.2); delay.delayTime.value = .42;
  const fb = c.createGain(); fb.gain.value = .34;
  delay.connect(fb).connect(delay);
  const wet = c.createGain(); wet.gain.value = .5;
  delay.connect(wet).connect(out);
  const bus = c.createGain(); bus.gain.value = 1; bus.connect(out); bus.connect(delay);
  let stopped = false;
  (function loop(){
    if(stopped) return;
    const t = c.currentTime + .05;
    const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < .2 ? .5 : 1);
    note(c, bus, f, t, 2.4, .16, "triangle");
    if(Math.random() < .3) note(c, bus, f * 1.5, t + .32, 1.8, .07, "sine");
    setTimeout(loop, 900 + Math.random() * 1600);
  })();
  return {stop(){ stopped = true; rain.stop(); }};
};
makers.pad = function(c, out){ // 晨间氛围：柔和 pad + 风铃
  const chords = [[261.63, 329.63, 392.0, 493.88], [220, 261.63, 329.63, 392.0], [293.66, 349.23, 440.0, 523.25], [196, 246.94, 293.66, 392.0]];
  let idx = 0, stopped = false;
  function playChord(){
    if(stopped) return;
    const t = c.currentTime + .05;
    const chord = chords[idx % chords.length]; idx++;
    chord.forEach(f => {
      [0, 3].forEach(det => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = .6;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(.028, t + 2.5);
        g.gain.setValueAtTime(.028, t + 7);
        g.gain.linearRampToValueAtTime(0, t + 9.5);
        o.connect(lp).connect(g).connect(out);
        o.start(t); o.stop(t + 10);
      });
    });
    // 风铃
    for(let i = 0; i < 2; i++){
      if(Math.random() < .7){
        const f = PENTA[Math.floor(Math.random() * PENTA.length)] * 2;
        note(c, out, f, t + Math.random() * 6, 3.2, .05, "sine");
      }
    }
    setTimeout(playChord, 8500);
  }
  playChord();
  return {stop(){ stopped = true; }};
};
makers.lofi = function(c, out){ // Lo-Fi 心流 BPM76：轻鼓 + 和弦 + 黑胶沙
  const bpm = 76, beat = 60 / bpm;
  let stopped = false, step = 0;
  const vinyl = loopNoise(c, {brown: false, filterType: "highpass", freq: 6000});
  vinyl.node.gain.value = .03; vinyl.node.connect(out);
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]];
  function tick(){
    if(stopped) return;
    const t = c.currentTime + .05;
    const s = step % 16;
    if(s % 8 === 0){ // kick
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + .12);
      g.gain.setValueAtTime(.34, t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
      o.connect(g).connect(out); o.start(t); o.stop(t + .2);
    }
    if(s % 4 === 2){ // hat
      const b = c.createBufferSource(); b.buffer = noiseBuffer(c, false);
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
      const g = c.createGain();
      g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.001, t + .05);
      b.connect(hp).connect(g).connect(out); b.start(t); b.stop(t + .08);
    }
    if(s === 0){ // 和弦
      const ch = chords[Math.floor(step / 16) % chords.length];
      ch.forEach(f => note(c, out, f, t + .01, beat * 3.4, .05, "triangle"));
      note(c, out, ch[0] * 2, t + beat * 2, beat * 1.6, .04, "sine");
    }
    step++;
    setTimeout(tick, beat * 1000 / 2); // 八分音符步进
  }
  tick();
  return {stop(){ stopped = true; try{ vinyl.src.stop(); }catch(e){} }};
};

/* ---------- 引擎：活跃源管理 ---------- */
const running = {}; // key -> {stop, gain}
function srcGain(key){
  const c = ac();
  const g = c.createGain();
  const p = prefs();
  g.gain.value = (p.vol[key] != null ? p.vol[key] : .5) * (p.vol.master != null ? p.vol.master : .9) * duckFactor;
  g.connect(ensureMaster());
  return g;
}
function startSource(key){
  if(running[key]) return;
  const c = ac(); if(!c) return;
  if(key === "local"){ localPlay(); running[key] = {stop(){ localStop(); }}; return; }
  if(key === "url"){ urlPlay(); running[key] = {stop(){ urlStop(); }}; return; }
  const mk = makers[key];
  if(!mk) return;
  const out = srcGain(key);
  const inst = mk(c, out);
  running[key] = {stop(){ try{ inst.stop(); out.disconnect(); }catch(e){} }};
}
function stopSource(key){
  genTok[key] = (genTok[key] || 0) + 1;   // 使该路未完成的加载作废
  if(running[key]){ running[key].stop(); delete running[key]; }
}
function anyPlaying(){ return Object.keys(running).length > 0; }

/* ---------- 主音量渐变 / 专注压低（沉浸专注层用） ----------
   两条链路必须一起管：合成音源在 WebAudio 的 gain 节点上（running[k].out），
   真实录音 / 本地音乐 / 音频库是 HTMLAudioElement（running[k].el / localAudio / urlAudio）。
   duckFactor 是独立乘数层，不写进 soundPrefs → 与用户的音量滑块互不覆盖。 */
let duckFactor = 1, duckTimer = null;
function rampNode(param, to, ms){
  const c = ac();
  if(!c){ param.value = to; return; }
  const now = c.currentTime;
  try{
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + Math.max(.01, ms / 1000));
  }catch(e){ param.value = to; }
}
function applyLevel(v){
  const p = prefs();
  const mv = p.vol.master != null ? p.vol.master : .9;
  Object.keys(running).forEach(k => {
    const r = running[k];
    const base = (p.vol[k] != null ? p.vol[k] : .5) * mv;
    if(r.el) r.el.volume = clamp01(base * v);
    if(r.out) rampNode(r.out.gain, clamp01(base * v), 60);
  });
  if(localAudio) localAudio.volume = clamp01((p.vol.local != null ? p.vol.local : .8) * mv * v);
  if(urlAudio) urlAudio.volume = clamp01((p.vol.url != null ? p.vol.url : .8) * mv * v);
}
/* 把环境音整体渐变到基准音量的 v 倍（1=恢复，0.55=专注压低，0=静音）
   没有音源在播时只记下目标值：不建 AudioContext、不排定时器（待机零成本），
   之后新起播的音源会按 srcGain/realVolume 里的 duckFactor 直接以该音量入场 */
function setDuck(to, ms){
  to = clamp01(to);
  if(duckFactor === to && !duckTimer) return;
  const from = duckFactor;
  duckFactor = to;
  if(duckTimer){ clearInterval(duckTimer); duckTimer = null; }
  if(!Object.keys(running).length) return;
  if(!ms){ applyLevel(to); return; }
  const steps = Math.max(2, Math.min(30, Math.round(ms / 40)));
  let i = 0;
  duckTimer = setInterval(() => {
    i++;
    applyLevel(from + (to - from) * (i / steps));
    if(i >= steps){ clearInterval(duckTimer); duckTimer = null; applyLevel(to); }
  }, Math.max(20, ms / steps));
}
/* 只改乘数、不动当前音量：用于「马上要从 0 渐入」的起点 */
function duckReset(v){ duckFactor = clamp01(v); }
/* 渐出到静音再执行收尾（番茄结束/放弃） */
function fadeOutThen(ms, done){
  if(!Object.keys(running).length){ duckFactor = 1; done(); return; }
  setDuck(0, ms);
  setTimeout(() => {
    if(duckTimer){ clearInterval(duckTimer); duckTimer = null; }
    duckFactor = 1;
    done();
  }, ms + 80);
}

function setVol(key, v){
  const p = prefs(); p.vol[key] = v; setPrefs(p);
  if(key === "master"){
    Object.keys(running).forEach(k => {
      if(k === "local" && localAudio) localAudio.volume = clamp01(v * (p.vol.local || .8));
      if(k === "url" && urlAudio) urlAudio.volume = clamp01(v * (p.vol.url || .8));
      if(running[k].el) running[k].el.volume = clamp01((p.vol[k] != null ? p.vol[k] : .5) * v);
    });
    if(localAudio && !running.local) localAudio.volume = clamp01(v * (p.vol.local || .8));
    applyLevel(duckFactor);   // 滑杆之后重新落一遍压低乘数，避免专注中被拉回满音量
    return;
  }
  if(running[key]){
    if(key === "local" && localAudio) localAudio.volume = clamp01(v * (p.vol.master || .9));
    else if(key === "url" && urlAudio) urlAudio.volume = clamp01(v * (p.vol.master || .9));
    else if(running[key].el) running[key].el.volume = clamp01(v * (p.vol.master || .9));
    else{
      const c = ac();
      // running[key].stop 存的是实例；重新拿不到 gain —— 简化：直接改 out（存引用）
      if(running[key].out) running[key].out.gain.value = clamp01(v * (p.vol.master || .9));
    }
  }
  applyLevel(duckFactor);
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
/* 把 out 引用记下来以便调音量 */
const _origStartSource = startSource;
startSource = function(key){
  if(running[key]) return;
  if(key === "local" || key === "url"){ _origStartSource(key); return; }
  const c = ac(); if(!c) return;
  const mk = makers[key]; if(!mk) return;
  if(REAL_SRC[key]){
    const myTok = genTok[key] = (genTok[key] || 0) + 1;
    running[key] = {stop(){}};   // 占位防重复触发；加载完成后替换为真实实例
    startReal(key).then(a => {
      if(genTok[key] !== myTok || !prefs().active[key]) return;
      if(!a){ realFallback(key, myTok); return; }
      a.volume = clamp01(realVolume(key) * duckFactor);   // 起播即带当前压低乘数，避免 40ms 内的爆音
      try{ a.currentTime = 0; }catch(e){}
      a.play().then(() => {
        if(genTok[key] !== myTok) return;
        running[key] = {el: a, stop(){ a.pause(); }};
      }).catch(() => realFallback(key, myTok));
      refreshPanel();
    });
    return;
  }
  const out = srcGain(key);
  const inst = mk(c, out);
  running[key] = {stop(){ try{ inst.stop(); out.disconnect(); }catch(e){} }, out};
};

/* ---------- 本地音乐播放器 ---------- */
let localAudio = null;
function musicList(){ return WB.store.get("musicList", []); }
function localPlay(){
  const list = musicList();
  const p = prefs();
  if(!list.length){ WB.ui.toast("先在下方添加本地音乐文件", "warn"); const st = prefs(); st.active.local = false; setPrefs(st); return; }
  if(!localAudio) localAudio = new Audio();
  const idx = Math.max(0, musicList().findIndex(m => m.id === p.localCur));
  localAudio._list = list;
  localAudio._idx = p.localMode === "shuffle" ? Math.floor(Math.random() * list.length) : (idx >= 0 ? idx : 0);
  playLocalIdx(localAudio._idx);
}
function playLocalIdx(i){
  const list = localAudio._list || musicList();
  if(!list.length) return;
  localAudio._idx = ((i % list.length) + list.length) % list.length;
  const item = list[localAudio._idx];
  WB.idb.get("music:" + item.id).then(rec => {
    if(!rec){ WB.ui.toast("找不到音频数据：" + item.name, "warn"); return; }
    const url = URL.createObjectURL(rec.data);
    localAudio.src = url;
    const p = prefs();
    localAudio.volume = clamp01((p.vol.local || .8) * (p.vol.master || .9));
    localAudio.onended = () => {
      const pp = prefs();
      if(pp.localMode === "one"){ playLocalIdx(localAudio._idx); return; }
      playLocalIdx(localAudio._idx + (pp.localMode === "shuffle" ? Math.floor(Math.random() * 3) + 1 : 1));
      refreshPanel && refreshPanel();
    };
    localAudio.play().catch(() => WB.ui.toast("播放失败", "warn"));
    const st = prefs(); st.localCur = item.id; setPrefs(st);
    refreshPanel && refreshPanel();
  });
}
function localStop(){ if(localAudio){ localAudio.pause(); } }
function localNext(){ if(localAudio) playLocalIdx(localAudio._idx + 1); }
function localPrev(){ if(localAudio) playLocalIdx(localAudio._idx - 1); }

/* ---------- 我的音频库（URL 直链） ---------- */
let urlAudio = null;
function urlLib(){ return WB.store.get("soundLibs", []); }
function urlPlay(){
  const lib = urlLib();
  const p = prefs();
  const item = lib.find(x => x.id === p.urlId) || lib[0];
  if(!item){ WB.ui.toast("声音库还是空的", "warn"); const st = prefs(); st.active.url = false; setPrefs(st); refreshPanel && refreshPanel(); return; }
  if(!urlAudio) urlAudio = new Audio();
  urlAudio.src = item.url;
  urlAudio.volume = clamp01((p.vol.url || .8) * (p.vol.master || .9));
  urlAudio.loop = true;
  urlAudio.play().catch(() => {
    WB.ui.toast("「" + item.name + "」暂时播不了，已标灰", "warn");
    item.dead = true;
    WB.store.set("soundLibs", lib);
    const st = prefs(); st.active.url = false; setPrefs(st);
    refreshPanel && refreshPanel();
  });
}
function urlStop(){ if(urlAudio) urlAudio.pause(); }

/* ---------- 面板 UI ---------- */
let panelRoot = null;
function refreshPanel(){ if(panelRoot) renderPanelInto(panelRoot); }

const SRC_META = [
  ["rain", "雨声", "rain"], ["waves", "海浪", "droplet"], ["white", "白噪", "wind"], ["fire", "篝火", "flame"],
  ["piano", "钢琴", "music"], ["pad", "晨间氛围", "sun"], ["lofi", "Lo-Fi 心流", "sparkle"],
];
function renderPanelInto(root){
  panelRoot = root;
  const p = prefs();
  root.innerHTML = "";
  /* 音源开关 + 音量 */
  const rows = el("div", {class: "col", style: {gap: "9px"}});
  SRC_META.forEach(([key, label, ic]) => {
    const on = !!p.active[key];
    const isReal = !!REAL_SRC[key];
    const st = realState[key];
    const showLabel = label + (isReal && on && st === "synth" ? "（合成）" : "");
    const loading = isReal && on && st === "loading";
    const r = el("div", {class: "row", style: {gap: "10px"}},
      el("button", {
        class: "chip clickable" + (on ? "" : " plain"),
        html: (loading ? '<span class="wb-mini-spin"></span>' : icon(ic, 14)) + "<span>" + showLabel + "</span>",
        style: on ? {background: "var(--accent-soft)"} : {},
        title: isReal ? (st === "synth" ? "录音文件缺失，当前为合成音源" : "真实录音 · 本地文件无缝循环（vendor/audio）") : "",
        onclick: () => {
          const st = prefs();
          if(st.active[key]){ st.active[key] = false; stopSource(key); }
          else{ st.active[key] = true; startSource(key); }
          setPrefs(st); renderPanelInto(root);
        }}),
      el("input", {type: "range", min: 0, max: 1, step: .01, value: p.vol[key],
        style: {flex: 1, accentColor: "var(--accent)"},
        oninput: e => setVol(key, parseFloat(e.target.value))}));
    rows.appendChild(r);
  });
  root.appendChild(rows);

  /* 本地音乐 */
  const local = el("div", {style: {borderTop: "1px dashed var(--card-border)", marginTop: "10px", paddingTop: "10px"}});
  const list = musicList();
  const modeSeg = el("div", {class: "seg"});
  [["order", "顺序"], ["shuffle", "随机"], ["one", "单曲"]].forEach(([v, l]) => modeSeg.appendChild(el("button", {
    class: p.localMode === v ? "on" : "", text: l,
    onclick: () => { const st = prefs(); st.localMode = v; setPrefs(st); renderPanelInto(root); }})));
  local.appendChild(el("div", {class: "row", style: {marginBottom: "8px"}},
    el("span", {class: "small muted"}, "本地音乐（" + list.length + "）"),
    el("span", {class: "grow"}),
    modeSeg));
  const fileIn = el("input", {type: "file", accept: "audio/*", multiple: true, style: {display: "none"}});
  fileIn.addEventListener("change", async () => {
    for(const f of fileIn.files){
      const id = WB.uid();
      await WB.idb.put("music:" + id, f, {name: f.name});
      const st = WB.store.get("musicList", []);
      st.push({id, name: f.name.replace(/\.[^.]+$/, "")});
      WB.store.set("musicList", st);
    }
    WB.ui.toast("已添加 " + fileIn.files.length + " 首");
    renderPanelInto(root);
  });
  local.appendChild(fileIn);
  const btns = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap"}});
  btns.appendChild(el("button", {class: "btn sm", html: icon("plus", 13) + "<span>加音频</span>", onclick: () => fileIn.click()}));
  btns.appendChild(el("button", {class: "btn sm", text: "▶ 播放", onclick: () => { const st = prefs(); st.active.local = true; setPrefs(st); startSource("local"); renderPanelInto(root); }}));
  btns.appendChild(el("button", {class: "btn sm ghost", text: "⏭ 下一首", onclick: localNext}));
  if(list.length){
    const cur = list.find(m => m.id === p.localCur);
    btns.appendChild(el("span", {class: "small faint ellipsis", style: {maxWidth: "130px"}, text: cur ? "♪ " + cur.name : ""}));
  }
  local.appendChild(btns);
  if(list.length){
    const chips = el("div", {class: "row", style: {flexWrap: "wrap", gap: "4px", marginTop: "6px"}});
    list.slice(0, 8).forEach(m => {
      chips.appendChild(el("button", {class: "chip plain clickable", text: m.name.slice(0, 10),
        onclick: () => { const st = prefs(); st.active.local = true; st.localCur = m.id; setPrefs(st); startSource("local"); localAudio && playLocalIdx(musicList().findIndex(x => x.id === m.id)); renderPanelInto(root); }}));
    });
    local.appendChild(chips);
  }
  root.appendChild(local);

  /* 我的音频库 */
  const lib = el("div", {style: {borderTop: "1px dashed var(--card-border)", marginTop: "10px", paddingTop: "10px"}});
  lib.appendChild(el("div", {class: "row", style: {marginBottom: "6px"}}, el("span", {class: "small muted"}, "我的声音库（在线直链）")));
  const urlIn = el("input", {class: "input", placeholder: "粘贴在线音频直链 https://…mp3", style: {fontSize: "13px"}});
  const nameIn = el("input", {class: "input", placeholder: "名字（可选）", style: {fontSize: "13px"}});
  lib.appendChild(el("div", {class: "field-row", style: {marginBottom: "6px"}}, urlIn, nameIn));
  lib.appendChild(el("button", {class: "btn sm", text: "＋收藏该音频", onclick: () => {
    const u = urlIn.value.trim();
    if(!/^https?:\/\//.test(u)){ WB.ui.toast("请以 https:// 开头", "warn"); return; }
    const st = WB.store.get("soundLibs", []);
    st.push({id: WB.uid(), name: nameIn.value.trim() || u.split("/").pop().slice(0, 16), url: u});
    WB.store.set("soundLibs", st);
    renderPanelInto(root);
  }}));
  const libList = urlLib();
  if(libList.length){
    const chips = el("div", {class: "row", style: {flexWrap: "wrap", gap: "4px", marginTop: "6px"}});
    libList.forEach(m => {
      chips.appendChild(el("button", {
        class: "chip clickable" + (m.dead ? " plain" : ""), text: (m.dead ? "× " : "♪ ") + m.name,
        style: m.dead ? {opacity: .45} : {},
        title: m.dead ? "上次播放失败" : m.url,
        onclick: () => {
          if(m.dead){ WB.ui.toast("该音频上次播放失败", "warn"); return; }
          const st = prefs(); st.active.url = true; st.urlId = m.id; setPrefs(st);
          startSource("url"); renderPanelInto(root);
        }}));
    });
    lib.appendChild(chips);
  }
  root.appendChild(lib);

  /* 歌单跳转 */
  const jumps = el("div", {style: {borderTop: "1px dashed var(--card-border)", marginTop: "10px", paddingTop: "10px"}});
  jumps.appendChild(el("div", {class: "small muted", style: {marginBottom: "6px"}, text: "歌单关键词直达："}));
  const kws = [["专注学习", "focus 学习"], ["白噪音", "白噪音"], ["钢琴", "钢琴 轻音乐"], ["Lo-Fi", "lofi work"], ["自然声", "自然 雨声"]];
  const jrow = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px"}});
  kws.forEach(([label, kw]) => {
    jrow.appendChild(el("button", {class: "chip plain clickable", text: label + " →网易云",
      onclick: () => window.open("https://music.163.com/#/search/m/?keyword=" + encodeURIComponent(kw) + "&type=1", "_blank")}));
    jrow.appendChild(el("button", {class: "chip plain clickable", text: label + " →Spotify",
      onclick: () => window.open("https://open.spotify.com/search/" + encodeURIComponent(kw), "_blank")}));
  });
  jumps.appendChild(jrow);
  root.appendChild(jumps);

  /* 主控 */
  const masterRow = el("div", {class: "row", style: {borderTop: "1px dashed var(--card-border)", marginTop: "10px", paddingTop: "10px"}},
    el("button", {class: "btn sm " + (anyPlaying() ? "primary" : ""),
      text: anyPlaying() ? "⏸ 全部暂停（空格 / M）" : "▶ 恢复上次组合",
      onclick: () => toggleAll()}),
    el("span", {class: "small muted", style: {marginLeft: "4px"}}, "主音量"),
    el("input", {type: "range", min: 0, max: 1, step: .01, value: p.vol.master,
      style: {flex: 1, accentColor: "var(--accent)"},
      oninput: e => setVol("master", parseFloat(e.target.value))}));
  root.appendChild(masterRow);
}

function toggleAll(){
  const p = prefs();
  const actives = Object.keys(p.active).filter(k => p.active[k]);
  if(anyPlaying()){
    Object.keys(running).forEach(stopSource);
    // local/url 也停
    refreshPanel();
  }else{
    if(!actives.length){
      // 默认开雨声
      p.active.rain = true; setPrefs(p); startSource("rain");
    }else{
      actives.forEach(k => startSource(k));
      if(actives.includes("local")){ const st = prefs(); st.active.local = true; setPrefs(st); startSource("local"); }
      if(actives.includes("url")){ const st = prefs(); st.active.url = true; setPrefs(st); startSource("url"); }
    }
    refreshPanel();
  }
}
function muteAll(){
  Object.keys(running).forEach(stopSource);
  const p = prefs();
  // 保留组合偏好，仅停播放
  refreshPanel && refreshPanel();
}
function restoreCombo(){
  const p = prefs();
  Object.keys(p.active).forEach(k => { if(p.active[k]) startSource(k); });
}

WB.registerModule({id: "sound-internal", title: "声音", icon: "music", hidden: true, render(){}});
WB.sound = {renderPanel(elx){ renderPanelInto(elx); }, toggle: toggleAll, muteAll, restoreCombo, anyPlaying,
  setDuck, duckReset, duckLevel(){ return duckFactor; }};

/* 番茄开始自动恢复组合；结束/收工先淡出再静音（原来 pomo:finish 全项目没人 emit，
   属于死订阅，2026-09-21 随沉浸专注层一并接上） */
WB.bus.on("pomo:start", restoreCombo);
WB.bus.on("pomo:finish", () => fadeOutThen(900, muteAll));
WB.bus.on("ritual:offwork", muteAll);
})();

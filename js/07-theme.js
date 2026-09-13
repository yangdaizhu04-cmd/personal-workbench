/* 07-theme.js —— 主题（晨雾奶油/夜雾）、三套点缀色、自定义强调色、壁纸 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

const DEFAULTS = {
  theme: "light",            // light | dark | auto
  accent: "mist",            // mist | peach | mint | custom
  accentCustom: "#7fa3bd",
  wallpaper: false,          // 兼容旧键：Bing 壁纸开关
  bgMode: "",                // blobs | dynamic | bing | custom（空=从旧键推导）
  motion: true,              // 动效
  quoteSource: "hitokoto",   // hitokoto | jinrishici | builtin
  pomodoroFocus: 25, pomodoroRest: 5,
  pomoSound: true, pomoFlash: true, pomoTitle: true,
  offworkHour: 18, birthdayAhead: 7,
  weatherCity: "",           // 手动城市（空=IP 定位）
  currencies: ["USD", "EUR", "JPY", "HKD"],
  aiEnabled: true,
  funPetDuringRest: false,
  themeCustomBg: "",         // 自定义背景图 dataURL（可选）
  lastExportTs: 0,           // 上次导出 JSON 备份的时间（快照提醒用）
};

function all(){
  return Object.assign({}, DEFAULTS, WB.store.get("settings", {}));
}
function get(key){
  return all()[key];
}
function set(key, val){
  const s = WB.store.get("settings", {});
  s[key] = val;
  WB.store.set("settings", s);
  apply();
  WB.bus.emit("settings:changed", {key, val});
}
function merge(patch){
  const s = Object.assign({}, WB.store.get("settings", {}), patch);
  WB.store.set("settings", s);
  apply();
  WB.bus.emit("settings:changed", patch);
}

function resolvedTheme(){
  const t = get("theme");
  if(t === "auto"){
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

function apply(){
  const html = document.documentElement;
  html.dataset.theme = resolvedTheme();
  const acc = get("accent");
  html.dataset.accent = acc === "custom" ? "mist" : acc;
  // 自定义强调色：覆盖 --accent / --accent-soft
  if(acc === "custom" && get("accentCustom")){
    const c = get("accentCustom");
    html.style.setProperty("--accent", c);
    html.style.setProperty("--accent-soft", WB.hexToRgba(c, .16));
  }else{
    html.style.removeProperty("--accent");
    html.style.removeProperty("--accent-soft");
  }
  html.classList.toggle("no-motion", !get("motion"));
  applyWallpaper();
}

function bgMode(){
  const s = all();
  if(s.bgMode) return s.bgMode;
  // 旧键兼容：无 bgMode 时从 wallpaper/themeCustomBg 推导
  return s.themeCustomBg ? "custom" : (s.wallpaper ? "bing" : "blobs");
}

function applyWallpaper(){
  const html = document.documentElement;
  const body = document.body;
  const mode = bgMode();
  const bg = get("themeCustomBg");
  if(mode === "custom" && bg){
    body.classList.add("wallpaper-on");
    body.classList.remove("bg-dynamic-on");
    body.style.backgroundImage = "url(" + bg + ")";
    return;
  }
  if(mode === "bing"){
    body.classList.remove("bg-dynamic-on");
    const today = WB.todayStr();
    const cache = WB.store.readCache("bingwp:" + today, 86400000);
    const setIt = url => {
      if(url){
        body.classList.add("wallpaper-on");
        body.style.backgroundImage = "url(" + url + ")";
      }
    };
    if(cache && cache.d){ setIt(cache.d); return; }
    // Bing 每日壁纸（biturl 提供 CORS；图本身 <img> 加载不受跨域限制）；失败回落奶油风
    WB.net.getJSON("https://bing.biturl.top/?resolution=1920&format=json&index=0", {timeout: 8000, cacheKey: "bingwp:" + today})
      .then(d => setIt(d && d.url));
    return;
  }
  body.classList.remove("wallpaper-on");
  body.style.backgroundImage = "";
  // 动态壁纸：晨露（亮色）/ 夜雾星座（暗色），由 islands/core.js 监听此类名挂载
  body.classList.toggle("bg-dynamic-on", mode === "dynamic");
}

function toggleTheme(){
  const cur = resolvedTheme();
  set("theme", cur === "dark" ? "light" : "dark");
  const btn = WB.$("#btn-theme");
  if(btn){
    btn.innerHTML = WB.icon(cur === "dark" ? "sun" : "moon");
    WB.ui.toast(cur === "dark" ? "回到晨雾奶油" : "夜雾模式，晚安");
  }
}

function init(){
  apply();
  const btn = WB.$("#btn-theme");
  if(btn){
    btn.innerHTML = WB.icon(resolvedTheme() === "dark" ? "sun" : "moon");
    btn.addEventListener("click", toggleTheme);
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if(get("theme") === "auto") apply();
  });
}

WB.theme = {DEFAULTS, all, get, set, merge, apply, toggleTheme, init, resolvedTheme, bgMode};
})();

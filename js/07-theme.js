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
  remindToast: true,             // 待办到点：无系统通知权限时在页面内弹提示（独立于番茄「全屏提示动画」开关）
  todoLast: {},                  // 上次新建待办用的清单与提前量（下次默认沿用）
  /* 沉浸专注层（js/16-immersive.js）：默认手动进入，快捷键 F 或计时卡「沉浸」 */
  pomoImmersive: true,           // 总开关
  pomoImmersiveAuto: false,      // 开始专注时自动进入
  pomoImmersiveScene: "mist",    // mist 晨雾 | deep 深海 | ember 篝火 | star 星野
  pomoImmersiveFull: true,       // 进入时请求浏览器全屏（被拒也能用）
  pomoImmersiveGuide: true,      // 3-2-1 准备 + 休息呼吸引导 + 静止自动隐藏控件
  pomoImmersiveVideo: true,      // 沉浸层的循环视频背景（vendor/video，4.5MB，仅沉浸时加载）
  pomoSoundDuck: true,           // 专注运行中把环境音压到约 55%
  offworkHour: 18, birthdayAhead: 7,
  weatherCity: "",           // 手动城市（空=IP 定位）
  currencies: ["USD", "EUR", "JPY", "HKD"],
  aiEnabled: true,
  funPetDuringRest: false,
  themeCustomBg: "",         // 自定义背景图 dataURL（可选）
  lastExportTs: 0,           // 上次导出 JSON 备份的时间（快照提醒用）
  firstSeenTs: 0,            // 首次使用时间：从未导出过时用它当提醒起点（免得从 1970 年算）
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

/* 用户是否显式设置过动效开关：显式设置优先于系统偏好（4.2） */
function motionUserSet(){
  const s = WB.store.get("settings", {});
  return Object.prototype.hasOwnProperty.call(s, "motion");
}

function apply(){
  const html = document.documentElement;
  const cur = resolvedTheme();
  html.dataset.theme = cur;
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
  // 3.3 地址栏/状态栏配色跟随主题（否则深色下仍是米白）
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = cur === "dark" ? "#232339" : "#f6f1e7";
  // 月亮/太阳图标必须在 apply() 里同步，不能只写在 toggleTheme()：
  // 设置页的分段控件走的是 theme.set、auto 模式还会跟随系统变化，
  // 只挂 toggleTheme 会让图标和实际主题脱节（亮色下显示太阳）
  const btn = WB.$("#btn-theme");
  if(btn && WB.ui && WB.ui.swapIcon) WB.ui.swapIcon(btn, "moon", "sun", cur === "dark");
  applyWallpaper();
}

function bgMode(){
  const s = all();
  if(s.bgMode) return s.bgMode;
  // 旧键兼容：无 bgMode 时从 wallpaper/themeCustomBg 推导
  return s.themeCustomBg ? "custom" : (s.wallpaper ? "bing" : "blobs");
}

function applyWallpaper(){
  const body = document.body;
  const mode = bgMode();
  const bg = get("themeCustomBg");
  if(mode === "custom" && bg){
    body.classList.add("wallpaper-on");
    body.classList.remove("bg-dynamic-on");
    body.style.backgroundImage = "url(" + bg + ")";
    adaptVeil(bg);
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
        adaptVeil(url);
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
  body.style.removeProperty("--wp-veil");
  // 动态壁纸：晨露（亮色）/ 夜雾星座（暗色），由 islands/core.js 监听此类名挂载
  body.classList.toggle("bg-dynamic-on", mode === "dynamic");
}

/* 3.5 壁纸对比度自适应：按图片平均亮度算蒙层透明度（700ms 由 CSS 过渡接管）
   跨域图会让 canvas 变成 tainted，getImageData 抛错 → 静默回落 CSS 默认值 */
function adaptVeil(url){
  const body = document.body;
  if(!url){ body.style.removeProperty("--wp-veil"); return; }
  const img = new Image();
  if(/^https?:/i.test(url)) img.crossOrigin = "anonymous";  // 仅远程图需要，dataURL 设了反而可能失败
  const fallback = () => body.style.removeProperty("--wp-veil");
  img.onload = () => {
    try{
      const N = 24, c = document.createElement("canvas");
      c.width = N; c.height = N;
      const g = c.getContext("2d", {willReadFrequently: true});
      g.drawImage(img, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      let lum = 0;
      for(let i = 0; i < d.length; i += 4) lum += (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) / 255;
      lum /= (d.length / 4);
      // 亮壁纸压得更实，暗壁纸可以多透出一些
      const alpha = Math.min(.86, Math.max(.55, .52 + lum * .34));
      body.style.setProperty("--wp-veil", alpha.toFixed(2));
    }catch(e){ fallback(); }
  };
  img.onerror = fallback;
  img.src = url;
}

function toggleTheme(){
  // 冷却闸门：与 --dur-scene(.7s) 交叉过渡对齐。否则连按 D 会在淡入淡出中途反复重启，
  // 渐变层被撕成两半（2.1）。返回 false 表示冷却中，本次操作整体丢弃。
  if(!WB.ui.lock("theme", 700)) return;
  const cur = resolvedTheme();
  set("theme", cur === "dark" ? "light" : "dark");   // set → apply，图标一并同步
  WB.ui.toast(cur === "dark" ? "回到晨雾奶油" : "夜雾模式，晚安");
}

function init(){
  apply();   // 图标 / meta / 壁纸的同步都在 apply 里，这里不再重复
  // 4.2 系统「减弱动态效果」作为默认值来源；用户显式设置过动效开关后以设置为准
  if(!motionUserSet() && matchMedia("(prefers-reduced-motion: reduce)").matches){
    document.documentElement.classList.add("no-motion");
  }
  const btn = WB.$("#btn-theme");
  if(btn) btn.addEventListener("click", toggleTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if(get("theme") === "auto") apply();
  });
}

WB.theme = {DEFAULTS, all, get, set, merge, apply, toggleTheme, init, resolvedTheme, bgMode,
  motionUserSet, adaptVeil};
})();

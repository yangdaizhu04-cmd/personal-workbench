/* 07-theme.js —— 主题（晨雾奶油/夜雾）、三套点缀色、自定义强调色、壁纸、
   照片自定义主题的档位与 token 落点（取色与记录见 07b-custom-theme.js） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

const DEFAULTS = {
  theme: "light",            // 主题 id，见文件下方的 THEMES 表（9 套）、auto 跟随系统、custom:<id> 照片主题
  accent: "mist",            // mist | peach | mint | custom
  accentCustom: "#7fa3bd",
  customInD: false,          // D 键是否也轮换照片主题（默认否：投屏时按 D 跳出私人照片太吓人）
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
  morningHour: 8,                // 晨间提醒时刻（只被桌面版后台提醒用；网页版的晨间仪式仍是"当天首次打开"触发）
  /* 桌面版（Tauri）：关窗后由 Rust 后台线程继续发系统通知，见 js/18-desktop.js。
     网页版/PWA 里这项无意义（没有后台线程），设置页只在桌面版显示这一行 */
  desktopNotify: true,
  weatherCity: "",           // 手动城市（空=IP 定位）
  currencies: ["USD", "EUR", "JPY", "HKD"],
  aiEnabled: true,
  funPetDuringRest: false,
  themeCustomBg: "",         // 自定义背景图 dataURL（可选）
  lastExportTs: 0,           // 上次导出 JSON 备份的时间（快照提醒用）
  firstSeenTs: 0,            // 首次使用时间：从未导出过时用它当提醒起点（免得从 1970 年算）
  customCss: "",             // 自定义 CSS 注入（高级）：挂载点统一在 apply() → #wb-custom-css
  /* 氛围引擎（js/17-ambience.js）：按时段自动编排 场景/音景/主题。
     默认关闭 —— 编排在位但不主动改界面，设置页确认后才生效 */
  ambienceOn: false,
  ambiencePlan: {},          // 用户编排（浅合并到 17-ambience.js 的 DEFAULT_PLAN 之上；空 = 全用默认）
  ambienceAsked: false,      // 设置页是否已经问过「要不要跟随节律」
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
  const th = themeMeta(cur);
  if(/^custom:/.test(cur) && !th.custom) noticeDegrade();
  /* 老主题的色块挂 data-theme；新六套只声明亮/暗档，色块挂 data-skin ——
     于是整套暗色框架（阴影 / 壁纸蒙层 / 玻璃描边等 47 处选择器）自动跟随。
     照片主题（custom:<id>）同理：档位只写 light/dark、不挂 data-skin，
     它那 19 个 token 由 applyVars() 写成行内样式（行内优先级最高，切走时整批清掉） */
  html.dataset.theme = th.own ? th.id : th.base;
  if(th.own || th.custom) delete html.dataset.skin; else html.dataset.skin = th.id;
  applyVars(th.custom ? th.vars : null);
  /* 照片主题的强调色是整套配色的一部分（由照片派生），此时点缀色预设让位；
     用户的 accent 设置原样留着，切回内置主题立刻恢复生效 */
  const acc = th.custom ? "mist" : get("accent");
  html.dataset.accent = acc === "custom" ? "mist" : acc;
  // 自定义强调色：覆盖 --accent / --accent-soft
  if(!th.custom && acc === "custom" && get("accentCustom")){
    const c = get("accentCustom");
    html.style.setProperty("--accent", c);
    html.style.setProperty("--accent-soft", WB.hexToRgba(c, .16));
  }else if(!th.custom){
    html.style.removeProperty("--accent");
    html.style.removeProperty("--accent-soft");
  }
  html.classList.toggle("no-motion", !get("motion"));
  // 3.3 地址栏/状态栏配色跟随主题（否则深色下仍是米白）
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = th.color;
  // 月亮/太阳图标必须在 apply() 里同步，不能只写在 toggleTheme()：
  // 设置页的分段控件走的是 theme.set、auto 模式还会跟随系统变化，
  // 只挂 toggleTheme 会让图标和实际主题脱节（亮色下显示太阳）
  const btn = WB.$("#btn-theme");
  if(btn && WB.ui && WB.ui.swapIcon) WB.ui.swapIcon(btn, "moon", "sun", th.dark);
  applyCustomCss();
  applyWallpaper();
}

/* 自定义 CSS 注入：唯一挂载点。设置页输入、导入备份、首次启动都汇到 apply()，
   派生状态不挂在具体入口上（踩坑 #040 同款教训） */
function applyCustomCss(){
  let tag = document.getElementById("wb-custom-css");
  const css = get("customCss") || "";
  if(!css){ if(tag) tag.remove(); return; }
  if(!tag){
    tag = document.createElement("style");
    tag.id = "wb-custom-css";
    document.head.appendChild(tag);
  }
  tag.textContent = css;   // textContent 不经 HTML 解析，无注入面
}

function bgMode(){
  const s = all();
  if(s.bgMode) return s.bgMode;
  // 旧键兼容：无 bgMode 时从 wallpaper/themeCustomBg 推导
  return s.themeCustomBg ? "custom" : (s.wallpaper ? "bing" : "blobs");
}

/* 照片主题的行内 token：写入 / 清除（编辑器里的预览也走这里）。
   清单只有一份（07b 的 VARS）：切走时按同一份 removeProperty，漏一个就会盖住内置主题 */
function applyVars(vars){
  const html = document.documentElement;
  if(vars){
    for(const k in vars) html.style.setProperty(k, vars[k]);
    return;
  }
  ((WB.customTheme && WB.customTheme.VARS) || []).forEach(k => html.style.removeProperty(k));
}

/* 预览（照片主题的新建/编辑弹窗）：只写档位与行内 token，不经 settings、不落库。
   结束预览 = 调一次 apply()：档位与 token 全部按 settings 重算，预览残留一并清掉 */
function previewVars(base, vars){
  const html = document.documentElement;
  html.dataset.theme = base === "dark" ? "dark" : "light";
  delete html.dataset.skin;
  applyVars(vars);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta && vars && vars["--bg"]) meta.content = vars["--bg"];
}

/* 降级提示（主题方案 §5）：settings.theme 指向的 custom:<id> 在本机找不到记录 ——
   换设备 / 清过 localStorage 会这样。界面已回落 light，这里只解释一句，每次启动最多一次 */
function noticeDegrade(){
  if(noticeDegrade.done) return;
  noticeDegrade.done = true;
  setTimeout(() => {
    if(WB.ui && WB.ui.toast) WB.ui.toast("这台设备上没有那套照片主题，已回到晨雾奶油", "warn");
  }, 1500);
}

function applyWallpaper(){
  /* 照片主题：照片就是背景（压过「背景」设置里的模式）。IDB 是异步的 ——
     命中缓存立刻挂；没命中就等 07b 取回来（期间保留上一帧的底，不闪白）；
     照片不在本机（只同步了 id、或备份里没带照片）→ 回落到背景模式，不留白屏 */
  const th = themeMeta(resolvedTheme());
  if(th.custom){
    const url = WB.customTheme.cached(th.id);
    if(url){ paintWallpaper(url); return; }
    WB.customTheme.photo(th.id).then(u => {
      if(resolvedTheme() !== th.id) return;    // 期间已经切走：不要覆盖新主题的壁纸
      if(u) paintWallpaper(u); else paintBgMode();
    });
    return;
  }
  paintBgMode();
}

/* 照片主题的背景：cap 只在这里给 —— 亮照片按默认口径会被蒙层压到 0.86，照片几乎看不见，
   而"照片主题"的卖点就是那张照片（卡片本身不透明，正文不压在背景上，0.74 实测仍清晰）。
   内置背景模式（Bing / 自定义图）一个字不动，仍走 adaptVeil(url) 的默认上限 */
function paintWallpaper(url){
  const body = document.body;
  body.classList.add("wallpaper-on");
  body.classList.remove("bg-dynamic-on");
  body.style.backgroundImage = "url(" + url + ")";
  adaptVeil(url, .74);
}

function paintBgMode(){
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
   跨域图会让 canvas 变成 tainted，getImageData 抛错 → 静默回落 CSS 默认值。
   cap = 蒙层不透明度的上限，默认 .86（只给照片主题传 .74，见 paintWallpaper） */
function adaptVeil(url, cap){
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
      const alpha = Math.min(cap || .86, Math.max(.55, .52 + lum * .34));
      body.style.setProperty("--wp-veil", alpha.toFixed(2));
    }catch(e){ fallback(); }
  };
  img.onerror = fallback;
  img.src = url;
}

/* ---------- 主题元数据表：加一套主题只改这一处 ----------
   加主题要动的落点都从这里派生：apply() 的 data-theme/data-skin、状态栏 theme-color、
   D 键的亮暗判据、设置页与氛围编排下拉的名单与中文名、冒烟脚本的主题数组。
   base：喂给 CSS 的档位；own：色块是否直接挂在 data-theme 上（三套老主题是，
   新六套挂 data-skin，见 css/main.css「新增主题」一节）；dark：算不算暗档；
   color：移动端状态栏 / PWA 的 theme-color。数组顺序 = 界面显示顺序 */
const THEMES = [
  {id: "light",  cn: "晨雾奶油", base: "light", own: true,  dark: false, color: "#f6f1e7"},
  {id: "dark",   cn: "夜雾",     base: "dark",  own: true,  dark: true,  color: "#232339"},
  {id: "rose",   cn: "暮霞粉",   base: "rose",  own: true,  dark: false, color: "#f9efe9"},
  {id: "spring", cn: "春芽",     base: "light", own: false, dark: false, color: "#f2f5ea"},
  {id: "sea",    cn: "夏海",     base: "light", own: false, dark: false, color: "#edf4f7"},
  {id: "maple",  cn: "秋枫",     base: "light", own: false, dark: false, color: "#f7f0e8"},
  {id: "snow",   cn: "冬雪",     base: "light", own: false, dark: false, color: "#f4f5f7"},
  {id: "ink",    cn: "墨岩",     base: "dark",  own: false, dark: true,  color: "#24282e"},
  {id: "hc",     cn: "高对比",   base: "light", own: false, dark: false, color: "#ffffff"},
];

/* 主题中文名：D 键提示、设置页、氛围引擎共用一份（别处不要再各写一句）。
   查不到的 id 一律回落 light —— 自定义主题的记录被清掉时界面也不能变白板 */
const THEME_CN = {auto: "跟随系统"};
THEMES.forEach(t => { THEME_CN[t.id] = t.cn; });
function themeMeta(id){
  const t = THEMES.find(t => t.id === id);
  if(t) return t;
  /* 照片主题 custom:<id>：记录由 07b-custom-theme.js 解析（名字/档位/token）；
     找不到就回落 light —— 换设备、清过 localStorage 时界面不能变白板，也不能报错 */
  const c = WB.customTheme && WB.customTheme.resolve(id);
  return c || THEMES[0];
}

/* 亮档的兜底：lastLightTheme 里只可能是内置 id（自定义主题另存 lastCustom:*），
   但仍要校验一次 —— 删过主题的机器上它可能已经是个不存在的 id */
function fallbackLight(){
  const id = WB.store.get("lastLightTheme", "light");
  return THEMES.some(t => t.id === id) ? id : "light";
}

function toggleTheme(){
  // 冷却闸门：与 --dur-scene(.7s) 交叉过渡对齐。否则连按 D 会在淡入淡出中途反复重启，
  // 渐变层被撕成两半（2.1）。返回 false 表示冷却中，本次操作整体丢弃。
  if(!WB.ui.lock("theme", 700)) return;
  const cur = resolvedTheme();
  const th = themeMeta(cur);
  /* D 键是「亮 ↔ 暗」二态（夜雾与墨岩都算暗档）；从暗切回来时回到你上次用的那套亮色主题 ——
     否则在暮霞粉下按两下 D，暮霞粉就被悄悄吃掉了，还得回设置页重新挑。
     照片主题单独记 lastCustom:light|dark，**默认不进轮换**（设置页 customInD 开关）：
     投屏时随手按 D 弹出一张私人照片，是这套功能最可能的翻车方式 */
  const isCustom = !!th.custom;
  if(isCustom) WB.store.set("lastCustom:" + th.base, cur);
  else if(!th.dark) WB.store.set("lastLightTheme", cur);
  const wantDark = !th.dark;
  const want = get("customInD") && WB.customTheme
    ? WB.customTheme.find(WB.store.get("lastCustom:" + (wantDark ? "dark" : "light"), ""))
    : null;
  const next = (want && WB.customTheme.PREFIX + want.id !== cur)
    ? WB.customTheme.PREFIX + want.id
    : (wantDark ? "dark" : fallbackLight());
  set("theme", next);   // set → apply，图标与照片一并同步
  const nextTh = themeMeta(next);
  WB.ui.toast(nextTh.dark ? nextTh.cn + "模式，晚安" : "回到" + nextTh.cn);
}

function init(){
  apply();   // 图标 / meta / 壁纸的同步都在 apply 里，这里不再重复
  // 照片主题：清掉 IDB 里没人引用的照片（清过 localStorage / 导入过别人的备份会留下孤儿）
  if(WB.customTheme && WB.customTheme.init) WB.customTheme.init();
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

WB.theme = {DEFAULTS, THEMES, THEME_CN, themeMeta, all, get, set, merge, apply, toggleTheme, init, resolvedTheme, bgMode,
  motionUserSet, adaptVeil, applyVars, previewVars, paintWallpaper, fallbackLight};
})();

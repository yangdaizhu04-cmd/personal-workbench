/* 19-app.js —— 移动端（Capacitor）桥：App 专属能力收敛在此，其它形态整体 no-op
   （与 18-desktop.js 对称：桌面的 Rust 桥在 18，移动的原生桥在 19）。

   为什么需要它：App 退后台后 WebView 会被系统冻结，通知 / 状态栏 / 返回键 / 常亮 /
   分享 / 落盘都要走原生插件；数据只在本机 WebView 里，原生读不到（同桌面版 #076）。

   形态隔离：__WB_APP__ 是编译期裸标识符 —— `node build.js --app` 用 esbuild define
   注入 true，其余形态（文件夹/单文件/--cloud/--tauri）不注入。这里用
   `typeof __WB_APP__ !== "undefined"` 兜底：零构建的文件夹版天然判 false，绝不抛错。 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

const isApp = typeof __WB_APP__ !== "undefined" && __WB_APP__;

/* 插件句柄：Capacitor 注入 window.Capacitor.Plugins。懒取 + 防御，插件未装时返回 null。 */
function plug(name){
  try{
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins[name]) || null;
  }catch(e){ return null; }
}

/* 暗档主题：data-theme 存 base 档（light/dark/rose 三档），dark/ink 是暗档，其余亮档。
   具体主题名（spring/sea/…）挂在 data-skin 上，不影响亮暗判定。 */
function isDark(){
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "ink";
}

/* 状态栏：透明 overlay + 背景色随主题 + 文字深浅随档位。任何一步失败静默降级，
   绝不让原生调用失败拖垮页面。背景色读 --bg 变量（唯一来源，与主题令牌一致）。 */
function syncStatusBar(){
  if(!isApp) return;
  const p = plug("StatusBar");
  if(!p) return;
  try{
    const dark = isDark();
    const cs = getComputedStyle(document.documentElement);
    const bg = (cs.getPropertyValue("--bg") || "").trim() || (dark ? "#232339" : "#f6f1e7");
    if(p.setOverlaysWebView) p.setOverlaysWebView({overlay: true});
    if(p.setBackgroundColor) p.setBackgroundColor({color: bg});
    if(p.setStyle) p.setStyle({style: dark ? "LIGHT" : "DARK"});
  }catch(e){}
}

/* 通知：走 20-appdata.js 的 Local Notifications（C 批）。
   App 里 WebView 的 new Notification() 和桌面版 WebView2 一样不可用，这条原生通道是
   「提醒可达」的唯一归宿。同步返回 true 表示"已交给原生通道"；实际发送是异步的，
   失败在 then 里用页内提示兜底（否则提醒会静默消失 —— 失败必须看得见）。 */
function notify(title, body, onClick){
  if(!isApp) return false;
  const p = WB.appData && WB.appData.notifyNative;
  if(!p) return false;
  p(title, body, onClick).then(ok => {
    if(!ok && WB.theme && WB.theme.all().remindToast && WB.ui){
      WB.ui.toast(title + " · " + body, "warn");
    }
  }).catch(() => {});
  return true;
}

if(isApp){
  /* App 形态标记：CSS 据此做 edge-to-edge 安全区适配（body.app-mode 只在 App 里加，
     网页/PWA/桌面/扩展里没有它，视觉零影响） */
  document.body.classList.add("app-mode");
  const App = plug("App");

  /* 返回键：复用 Esc 的关闭栈（modal/sheet/cmdk → 沉浸层 → 窗景），
     到底层退后台（minimizeApp）而非杀进程 —— 杀进程会连番茄计时的心跳一起带走。 */
  if(App && App.addListener){
    App.addListener("backButton", () => {
      try{
        if(WB.modalOpen && WB.modalOpen()){ WB.closeTopModal(); return; }
        if(WB.immersive && WB.immersive.isActive()){ WB.immersive.exit(); return; }
        const viewer = document.getElementById("scene-viewer");
        if(viewer && !viewer.hidden && WB.scenes && WB.scenes.close){ WB.scenes.close(); return; }
      }catch(e){}
      if(App.minimizeApp) App.minimizeApp();
    });

    /* 生命周期：退后台/回前台广播 app:state（C 批环境音「退后台暂停、回前台恢复」消费它） */
    App.addListener("appStateChange", s => {
      if(WB.bus && WB.bus.emit) WB.bus.emit("app:state", {isActive: !!(s && s.isActive)});
    });
  }

  /* 启动屏：入场雾开（veil ~1.4s）结束后隐藏，避免白闪。真机联调再精调时刻。 */
  const hideSplash = () => {
    const p = plug("SplashScreen");
    if(p && p.hide) p.hide();
  };
  if(document.readyState === "complete") setTimeout(hideSplash, 900);
  else window.addEventListener("load", () => setTimeout(hideSplash, 900));

  /* 状态栏：初始同步一次 + 主题变化时重同步（用 MutationObserver，不动共享主题文件） */
  syncStatusBar();
  if(window.MutationObserver){
    new MutationObserver(syncStatusBar).observe(document.documentElement,
      {attributes: true, attributeFilter: ["data-theme", "data-skin", "data-accent"]});
  }
}

WB.app = { available: () => isApp, notify, syncStatusBar, isDark };
})();

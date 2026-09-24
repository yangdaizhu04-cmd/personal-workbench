/* 01-utils.js —— 基础工具（全局命名空间 WB） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* DOM */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function el(tag, attrs, ...children){
  const node = document.createElement(tag);
  if(attrs){
    for(const [k,v] of Object.entries(attrs)){
      if(v == null || v === false) continue;
      if(k === "class") node.className = v;
      else if(k === "html") node.innerHTML = v;
      else if(k === "text") node.textContent = v;
      else if(k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if(k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if(k === "dataset") Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    }
  }
  for(const c of children.flat(9)){
    if(c == null || c === false) continue;
    node.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
  return node;
}
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, m =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

/* 通用 */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function debounce(fn, ms){ let t; return function(...a){ clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function copyText(text){
  if(navigator.clipboard && window.isSecureContext !== false){
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text){
  const ta = el("textarea", {value: text, style:{position:"fixed", opacity:"0"}});
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand("copy"); }catch(e){}
  ta.remove(); return true;
}
function downloadFile(name, content, mime){
  const blob = content instanceof Blob ? content : new Blob([content], {type: mime || "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = el("a", {href: url, download: name});
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 400);
}

/* 日期（业务日：凌晨 4 点前算昨天） */
const pad = n => String(n).padStart(2, "0");
function dateStr(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseDate(s){ const [y,m,d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n){ const d = typeof s === "string" ? parseDate(s) : new Date(s); d.setDate(d.getDate() + n); return d; }
function addDaysStr(s, n){ return dateStr(addDays(s, n)); }
function todayStr(){ return dateStr(new Date()); }
function bizDate(){
  const now = new Date();
  if(now.getHours() < 4) return dateStr(addDays(now, -1));
  return dateStr(now);
}
function bizNow(){ // 凌晨 1-4 点视作昨天同时段（用于"今日待办"判断边界的顺滑）
  const now = new Date();
  return now;
}
const WEEK_CN = ["周日","周一","周二","周三","周四","周五","周六"];
function weekdayCN(s){ return WEEK_CN[parseDate(s).getDay()]; }
function fmtDateCN(s, withWeek){
  const d = parseDate(s);
  const t = (d.getMonth() + 1) + "月" + d.getDate() + "日";
  return withWeek ? t + " " + weekdayCN(s) : t;
}
function daysBetween(a, b){ // a,b: 'YYYY-MM-DD' → b - a（天）
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
function relDayLabel(s){ // 相对今天（业务日）的口语标签
  const diff = daysBetween(bizDate(), s);
  if(diff === 0) return "今天";
  if(diff === 1) return "明天";
  if(diff === 2) return "后天";
  if(diff === -1) return "昨天";
  if(diff < 0) return Math.abs(diff) + " 天前";
  return diff + " 天后";
}
function fmtTime(ts){
  const d = new Date(ts);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmtMonth(s){ return s.slice(0, 7); } // YYYY-MM
function monthStr(d){ return d.getFullYear() + "-" + pad(d.getMonth() + 1); }

/* 颜色工具（清单色/心情色） */
function hexToRgba(hex, a){
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
}

/* 数组 */
function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/* 稳定的"每天随机"：以日期为种子取一项 */
function pickDaily(list, dateKey){
  let h = 0;
  const key = dateKey || todayStr();
  for(let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* 通知
   桌面版（Tauri）交给 Rust 走「系统通知 / 自绘提醒卡」那条通道：
   WebView2 里的 `new Notification()` **不会显示任何东西**（WebView2 要求宿主实现通知
   回调，Tauri 没实现），于是应用开着的时候提醒是静默的 —— 而关掉窗口反倒能收到卡片，
   同一件事两条路两种结果（踩坑 #079）。
   网页版 / PWA / 扩展里没有这条桥，行为与以前完全一致（浏览器原生通知）。 */
function notify(title, body, onClick){
  try{
    if(window.WB && WB.desktop && WB.desktop.available && WB.desktop.available() && WB.desktop.notifyNow){
      /* 桌面版：统一走 Rust 那条通道。后台提醒总开关关掉时桌面端保持安静，
         退回页面内提示（remindToast），而不是继续弹卡片 */
      if(WB.theme.all().desktopNotify === false) return false;
      WB.desktop.notifyNow(title, body);
      return true;
    }
    if(!("Notification" in window)) return false;
    if(Notification.permission === "granted"){
      const n = new Notification(title, {body, silent: document.documentElement.classList.contains("no-motion")});
      if(onClick) n.onclick = () => { try{ window.focus(); onClick(); }catch(e){} };
      return true;
    }
  }catch(e){}
  return false;
}
function ensureNotifyPermission(){
  try{
    if("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }catch(e){}
}

Object.assign(WB, {
  $, $$, el, esc, uid, debounce, clamp, copyText, downloadFile,
  dateStr, parseDate, addDays, addDaysStr, todayStr, bizDate, bizNow,
  WEEK_CN, weekdayCN, fmtDateCN, daysBetween, relDayLabel, fmtTime, fmtMonth, monthStr,
  hexToRgba, shuffle, pickDaily, notify, ensureNotifyPermission,
});
})();

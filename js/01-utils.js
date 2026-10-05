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
/* URL 协议白名单：esc 只处理 & < > " ' 五个字符，**不处理 scheme**，
   于是笔记里写 `[x](javascript:alert(1))` 会渲染出一个可点的可执行链接。
   凡是「把用户填的地址交给 href / window.open / location」的地方都先过这里。
   相对地址与锚点放行（站内锚点是正常用法），其余一律降级成空串 ——
   宁可少一个链接，也不要一个能执行的伪协议。 */
const SAFE_URL = /^(https?:|mailto:|tel:)/i;
/* 浏览器解析 scheme 时会忽略 ASCII 空白与控制字符，所以夹带制表符/换行的伪协议
   照样能执行。判协议前先剔掉这些字符再比；剔净的副本只用于判别，
   返回给调用方的仍是用户填的原串（不改动地址本身）。
   剔除用 split+join 而不是「带控制字符区间的正则」：一来好读，二来不触发 oxlint 的
   no-control-regex（那条规则拦的是正则里混进真实控制字符，这里只按码点判断，更直白）。 */
const URL_IGNORED = c => c.charCodeAt(0) <= 32;
function safeUrl(u){
  const s = String(u == null ? "" : u).trim();
  if(!s) return "";
  if(SAFE_URL.test(s.split("").filter(c => !URL_IGNORED(c)).join(""))) return s;
  if(/^[#/.]/.test(s)) return s;               // 站内锚点 / 相对路径
  return "";
}
/* 金额取数：**只有这一处口径**。
   账目金额在本项目里是「分单位的整数」，但导入的 JSON 可以把它写成字符串
   （JSON 允许 `"amount": "12.5"`），于是：
     s + l.amount        → 0 + "12.5" = "012.5"（字符串拼接，静默错）
     "012.5".toFixed(0)  → TypeError（AI 助手的「近 7 天支出」整个不可用）
     Math.round(x*100)   → NaN（周报里出现「支出 ¥NaN」）
   以前项目里有三种写法并存（sheets/yearReview 用 `Number(l.amount) || 0`、
   today/journal 用 `l.amount || 0`、assistant/stats/ledger 用裸 `l.amount`），
   只有裸写的那种会抛 —— 统一到这一个函数，异常输入最多算成 0，不会崩（踩坑 #098）。 */
function amount(v){
  if(typeof v === "number") return Number.isFinite(v) ? v : 0;
  if(typeof v === "string"){ const t = v.trim(); if(!t) return 0; const n = Number(t); return Number.isFinite(n) ? n : 0; }
  return 0;
}
/* 整数取数：`parseInt(x) || 默认值` 会把**合法的 0** 静默换成默认值
   （「专注时长填 0」→ 变回 25 而不是钳到 1；「目标次数填 0」→ 变回 8）。
   这里显式区分「空/非法」与「0」（踩坑 #099）。 */
function toInt(v, fallback){
  if(typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : fallback;
  const s = String(v == null ? "" : v).trim();
  if(!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
/* 浮点取数，同上（「音量调到 0」被 `|| 0.8` 顶回默认值）。 */
function num(v, fallback){
  const n = typeof v === "string" ? Number(v.trim() || "") : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/* CSV 单元格。**加引号不能挡公式注入** ——
   分类名/备注里写 `="cmd|'/c calc'!A0"`，即使被引号包着，Excel 打开照样执行（引号内仍是公式）。
   真正要挡的是"以公式字符开头"：= + - @ 以及制表/回车。
   这些值都是用户自己填的（分类名、账目备注），导出的账单 CSV 会被 Excel/WPS 打开。 */
function csvCell(v){
  let s = String(v == null ? "" : v);
  if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/* 颜色白名单：<input type=color> 只会给 #rrggbb，但**导入的 JSON 能塞任意字符串**，
   而颜色在渲染处常常落在 `style="...background:` + 值 + `"` 的属性上下文里 ——
   一个闭合引号就能逃逸出去（与 XSS 同一类问题）。非 #hex 一律回落默认色。 */
function safeColor(c, fallback){
  const s = String(c == null ? "" : c).trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : (fallback || "");
}

/* 通用 */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function debounce(fn, ms){ let t; return function(...a){ clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
/* 待办提醒的两个常量：**只此一份**。js/18-desktop.js（关窗后的后台提醒清单）
   与 js/main.js（窗口可见时的提醒调度）都读这里 —— 复制成两份就会漂，
   表现是"开窗与关窗两种状态下提前量/有效期不一致" */
const REMIND_AHEAD = {"0": 0, "5": 5, "10": 10, "30": 30};   // 提前多少分钟
const TODO_WINDOW_MIN = 30;                                   // 到点后多久之内还算数
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
  $, $$, el, esc, safeUrl, safeColor, amount, toInt, num, csvCell, uid, debounce, clamp, copyText, downloadFile, REMIND_AHEAD, TODO_WINDOW_MIN,
  dateStr, parseDate, addDays, addDaysStr, todayStr, bizDate, bizNow,
  WEEK_CN, weekdayCN, fmtDateCN, daysBetween, relDayLabel, fmtTime, fmtMonth, monthStr,
  hexToRgba, shuffle, pickDaily, notify, ensureNotifyPermission,
});
})();

/* 07b-custom-theme.js —— 照片自定义主题：取色 / IDB 存照 / 应用与降级 / 管理 UI
   方案与验收口径：主题方案.md §3~§6、§9 批次 2。三条不可动摇的约定：
   ① **照片一个字节都不出本机**：元数据（名字/档位/色值）在 localStorage `wb:customThemes`，
      照片与缩略图在 IndexedDB（`theme:<id>` / `theme:<id>:thumb`，复用 03-idb.js 现成的库）。
      云同步白名单里没有 customThemes，settings.theme 只带走一个 "custom:<id>" 字符串。
   ② **apply() 是唯一写界面的人**：本文件提供「解析记录 / 派生 token / 照片 URL / 编辑器」，
      真正写 data-theme 与行内 token 的仍只有 07-theme.js 的 apply()（预览走 previewVars）。
   ③ **记录找不到就降级**（换设备 / 清过 localStorage）：回落到内置主题，不白屏、不报错（§5） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const {el, icon} = WB;

const KEY = "customThemes";        // store 键 → localStorage 的 wb:customThemes
const PREFIX = "custom:";          // settings.theme 的前缀（沿用字符串字段，不改结构）
const MAX = 20;                    // 套数上限（方案 §10-4）
const IMG_KEY = id => "theme:" + id;
const THUMB_KEY = id => "theme:" + id + ":thumb";

/* 会写进 html 行内样式的 token 清单。切走时按这份清单整批 removeProperty ——
   漏一个就会把内置主题盖住（07-theme.js 的清理也读这份清单，只有这一处） */
const VARS = ["--bg", "--bg-2", "--card", "--card-2", "--card-border",
  "--ink", "--ink-2", "--ink-3", "--accent", "--accent-2", "--accent-ink",
  "--accent-soft", "--accent2-soft", "--veil", "--wp-tint",
  "--glass-bg", "--glass-line-a", "--glass-line-b", "--glass-line-c"];

/* ============================ 颜色工具（本文件自用） ============================ */
function h2r(hex){
  const h = String(hex || "").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function r2h(rgb){
  return "#" + rgb.map(v => Math.round(WB.clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
}
function lin(c){ c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
/* WCAG 相对亮度与对比度：断言口径见 §13.5 —— 半透明底必须先合成实色再比 */
function lum(rgb){ return .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]); }
function ratio(hexA, hexB){
  const a = lum(h2r(hexA)), b = lum(h2r(hexB));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function rgbHsl(rgb){
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0, s = 0;
  if(d){
    s = d / (1 - Math.abs(2 * l - 1) || 1);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return {h, s, l};
}
function hslRgb({h, s, l}){
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [t[0] + m, t[1] + m, t[2] + m].map(v => Math.round(v * 255));
}
function hsl(h, s, l){ return r2h(hslRgb({h, s: WB.clamp(s, 0, 1), l: WB.clamp(l, .01, .99)})); }
function mix(a, b, t){
  const A = h2r(a), B = h2r(b);
  return r2h([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
/* 朝「更亮（dir=1）/ 更暗（dir=-1）」把颜色调到与底色对比度达标，色相与饱和度不动。
   相对亮度对 HSL 明度单调 → 逐档走必然收敛。这是「用户配出看不见的字」的兜底防线：
   ink / ink-2 / ink-3 / accent-ink 全部过这一关，而不是靠公式碰运气 */
function ensure(hex, bg, min, dir){
  const c = rgbHsl(h2r(hex));
  let l = c.l;
  for(let i = 0; i < 70; i++){
    const cur = hsl(c.h, c.s, l);
    if(ratio(cur, bg) >= min) return cur;
    l += dir * .015;
    if(l <= .04 || l >= .97) break;
  }
  return hsl(c.h, c.s, WB.clamp(l, .04, .97));
}

/* ============================ 取色 + 派生 ============================ */
const FALLBACK_ACCENT = {light: "#7fa3bd", dark: "#8fa6d8"};

/* 缩到 64×64 读像素（同 07-theme.js:176 的 willReadFrequently 写法）：
   基底 = 全图加权相对亮度（与 adaptVeil 同一公式）；强调色 = 过曝 / 过暗 / 灰的像素剔除后，
   按 24 个色相桶统计「饱和度² × 出现占比」，取票数最高的桶的平均色 ——
   灰墙与阴影不会把主色带偏，艳色哪怕只占一角也能被选中（这正是「像那张照片」的关键） */
function analyze(img){
  const N = 64, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d", {willReadFrequently: true});
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  const buckets = [];
  for(let i = 0; i < 24; i++) buckets.push({w: 0, r: 0, g: 0, b: 0});
  let lumSum = 0, n = 0;
  for(let i = 0; i < d.length; i += 4){
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    lumSum += (.2126 * r + .7152 * gg + .0722 * b) / 255;
    n++;
    const mx = Math.max(r, gg, b) / 255, mn = Math.min(r, gg, b) / 255;
    const sat = mx ? (mx - mn) / mx : 0;
    const l = (.2126 * r + .7152 * gg + .0722 * b) / 255;
    if(l > .93 || l < .07 || sat < .12) continue;
    const w = sat * sat;
    const bk = buckets[Math.min(23, Math.floor(rgbHsl([r, gg, b]).h / 15))];
    bk.w += w; bk.r += r * w; bk.g += gg * w; bk.b += b * w;
  }
  const lumAvg = n ? lumSum / n : .5;
  let best = null;
  for(const bk of buckets){ if(bk.w > 0 && (!best || bk.w > best.w)) best = bk; }
  return {
    base: lumAvg < .42 ? "dark" : "light",
    lum: Math.round(lumAvg * 100) / 100,
    accent: best ? r2h([best.r / best.w, best.g / best.w, best.b / best.w]) : null,
  };
}

/* 由「档位 + 强调色」派生整套 token（首次取色、用户改档位、改强调色都走这一条路）。
   只派生 19 个 token；阴影 / 蒙层（scrim）/ 危险·成功·警告色 / pri-mask 仍用底座主题的值，
   于是 css/main.css 的结构一行都不用改（方案 §4.7） */
function derive(base, accent){
  const dark = base === "dark";
  const dir = dark ? 1 : -1;
  const a = rgbHsl(h2r(accent || FALLBACK_ACCENT[base] || FALLBACK_ACCENT.light));
  const hue = a.h, sat = a.s;
  const bg = dark ? hsl(hue, Math.min(sat, .20), .17) : hsl(hue, Math.min(sat, .34), .945);
  const bg2 = dark ? hsl(hue, Math.min(sat, .20), .135) : hsl(hue, Math.min(sat, .34), .905);
  const card = dark ? hsl(hue, Math.min(sat, .22), .215) : hsl(hue, Math.min(sat, .30), .975);
  const card2 = dark ? hsl(hue, Math.min(sat, .22), .19) : hsl(hue, Math.min(sat, .30), .94);
  /* ink / ink-2 / ink-3 由档位定，不交给照片决定（浅底近黑、深底近白），再各自过对比度底线 */
  const ink = ensure(dark ? hsl(hue, Math.min(sat, .30), .93) : hsl(hue, Math.min(sat, .28), .235), bg, 7, dir);
  const ink2 = ensure(dark ? hsl(hue, Math.min(sat, .26), .745) : hsl(hue, Math.min(sat, .26), .44), bg, 4.6, dir);
  const ink3 = ensure(dark ? hsl(hue, Math.min(sat, .24), .615) : hsl(hue, Math.min(sat, .24), .55), bg, 3.3, dir);
  /* 强调色：先在底色上 ≥3:1（它还要当链接与图标色用），
     再保证「淡底上的文字」——口径是 --accent-soft 叠在 --card 上的**合成实色**，不是强调色实色（踩坑 #086） */
  const acc = ensure(accent || FALLBACK_ACCENT[base], bg, 3, dir);
  const acc2 = ensure(hsl(a.h + 40, a.s, a.l), bg, 3, dir);
  const softA = dark ? .18 : .15;
  const accInk = ensure(acc, mix(card, acc, softA), 4.5, dir);
  const lineTint = dark ? mix(ink, bg, .62) : "#ffffff";
  const vars = {
    "--bg": bg, "--bg-2": bg2, "--card": card, "--card-2": card2,
    "--card-border": WB.hexToRgba(mix(ink, bg, dark ? .55 : .35), dark ? .14 : .16),
    "--ink": ink, "--ink-2": ink2, "--ink-3": ink3,
    "--accent": acc, "--accent-2": acc2, "--accent-ink": accInk,
    "--accent-soft": WB.hexToRgba(acc, softA),
    "--accent2-soft": WB.hexToRgba(acc2, dark ? .18 : .16),
    "--veil": WB.hexToRgba(bg, .96),
    "--wp-tint": h2r(bg).join(" "),
    "--glass-bg": WB.hexToRgba(card, dark ? .56 : .52),
    "--glass-line-a": WB.hexToRgba(lineTint, dark ? .20 : .55),
    "--glass-line-b": WB.hexToRgba(lineTint, dark ? .08 : .15),
    "--glass-line-c": WB.hexToRgba(lineTint, 0),
  };
  return {seed: {bg, card, ink, ink3, accent: acc, accent2: acc2}, vars};
}

function loadImage(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/* 单张照片 → 一套配色。输入用**压缩后**的图（颜色几乎一致，但省一次大图解码；
   顺带把「浏览器解不开的格式」（HEIC 等）在这一步就拦下来） */
async function pickPalette(blob){
  const url = URL.createObjectURL(blob);
  try{
    const img = await loadImage(url);
    const r = analyze(img);
    const accent = r.accent || FALLBACK_ACCENT[r.base];
    const d = derive(r.base, accent);
    return {base: r.base, accent, gray: !r.accent, lum: r.lum, seed: d.seed, vars: d.vars};
  }finally{ URL.revokeObjectURL(url); }
}

/* 文件 → {photo, thumb, 配色}：长边 1600 当壁纸、480 当缩略图（方案 §3） */
async function source(file){
  if(file && /gif/i.test(file.type || "")) WB.ui.toast("动图只取第一帧，会做成静帧", "warn");
  const photo = await WB.idb.compressImage(file, 1600, .8);
  const thumb = await WB.idb.compressImage(file, 480, .72);
  const p = await pickPalette(photo);
  return Object.assign({photo, thumb}, p);
}

/* ============================ 记录 + 照片（IDB） ============================ */
function list(){ return WB.store.get(KEY, []) || []; }
function saveAll(arr){ WB.store.set(KEY, arr); }
function bare(id){
  const s = String(id == null ? "" : id);
  return s.indexOf(PREFIX) === 0 ? s.slice(PREFIX.length) : s;   // 只剥前缀，不从中间替换
}
function find(id){
  const k = bare(id);
  return list().find(r => r.id === k) || null;
}
function has(id){ return !!find(id); }

/* themeMeta 的解析钩子（07-theme.js 调用）：把 custom:<id> 解析成与内置主题同构的元数据。
   记录找不到返回 null → 由调用方回落到 light（降级，无提示也不报错） */
function resolve(id){
  const rec = find(id);
  if(!rec) return null;
  return {
    id: PREFIX + rec.id, cn: rec.name || "照片主题", base: rec.base === "dark" ? "dark" : "light",
    own: false, custom: true, skin: "", dark: rec.base === "dark",
    color: (rec.vars && rec.vars["--bg"]) || (rec.base === "dark" ? "#24282e" : "#f6f1e7"),
    vars: rec.vars || {},
  };
}

/* objectURL 缓存：切主题来回切 20 次不该重复 createObjectURL（验收 §9-2）。
   换图 / 删除时 revoke，其余时间每套主题最多两个 URL（大图 + 缩略图） */
const urls = new Map();     // id -> {url, thumb}
const pending = new Map();
async function getBlob(key){
  const rec = await WB.idb.get(key);
  return (rec && rec.data) || null;
}
function photoURL(id, thumb){
  const k = bare(id), slotName = thumb ? "thumb" : "url", pk = k + (thumb ? ":t" : "");
  const slot = urls.get(k);
  if(slot && slot[slotName]) return Promise.resolve(slot[slotName]);
  if(pending.has(pk)) return pending.get(pk);
  const p = getBlob(thumb ? THUMB_KEY(k) : IMG_KEY(k)).then(blob => {
    if(!blob) return null;
    const u = URL.createObjectURL(blob);
    const next = urls.get(k) || {};
    next[slotName] = u;
    urls.set(k, next);
    return u;
  }).catch(() => null).then(u => { pending.delete(pk); return u; });
  pending.set(pk, p);
  return p;
}
function cached(id){ const s = urls.get(bare(id)); return (s && s.url) || null; }
function photo(id){ return photoURL(bare(id), false); }
function revoke(id){
  const k = bare(id), s = urls.get(k);
  if(!s) return;
  if(s.url) URL.revokeObjectURL(s.url);
  if(s.thumb) URL.revokeObjectURL(s.thumb);
  urls.delete(k);
}
/* 换图 / 删除时用这个：缓存立刻失效（后续 photo() 会重新从 IDB 读），
   但 URL 延迟两秒才 revoke —— 旧 URL 此刻可能正挂在 body 的背景上，
   立即撤销会让那一帧的背景消失（新图铺好之前先别撤） */
function invalidate(id){
  const k = bare(id), s = urls.get(k);
  if(!s) return;
  urls.delete(k);
  setTimeout(() => {
    if(s.url) URL.revokeObjectURL(s.url);
    if(s.thumb) URL.revokeObjectURL(s.thumb);
  }, 2000);
}

async function create({name, base, accent, photo, thumb}){
  const d = derive(base, accent);
  const id = "ct_" + WB.uid().slice(-6);
  const ok1 = await WB.idb.put(IMG_KEY(id), photo, {kind: "theme-photo"});
  const ok2 = await WB.idb.put(THUMB_KEY(id), thumb, {kind: "theme-thumb"});
  if(!ok1 || !ok2){
    await WB.idb.del(IMG_KEY(id)); await WB.idb.del(THUMB_KEY(id));
    return null;
  }
  const rec = {
    id, name: String(name || "").trim() || "照片主题",
    base: base === "dark" ? "dark" : "light",
    accent, seed: d.seed, vars: d.vars, imgKey: IMG_KEY(id), thumbKey: THUMB_KEY(id),
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  saveAll(list().concat(rec));
  return rec;
}

async function update(id, patch){
  const rec = find(id);
  if(!rec) return null;
  if(patch.photo && patch.thumb){
    const ok1 = await WB.idb.put(IMG_KEY(rec.id), patch.photo, {kind: "theme-photo"});
    const ok2 = await WB.idb.put(THUMB_KEY(rec.id), patch.thumb, {kind: "theme-thumb"});
    if(!ok1 || !ok2) return null;
    invalidate(rec.id);                   // 换图：旧的两个 URL 作废（延迟撤销，见 invalidate）
  }
  const next = Object.assign({}, rec);
  if(patch.name != null) next.name = String(patch.name).trim() || rec.name;
  if(patch.base) next.base = patch.base === "dark" ? "dark" : "light";
  if(patch.accent) next.accent = patch.accent;
  const d = derive(next.base, next.accent);
  next.seed = d.seed; next.vars = d.vars; next.updatedAt = Date.now();
  saveAll(list().map(r => (r.id === rec.id ? next : r)));
  if(WB.theme.get("theme") === PREFIX + rec.id) WB.theme.apply();   // 正在用 → 立刻重画
  return next;
}

async function del(id){
  const rec = find(id);
  if(!rec) return false;
  /* 删除不走回收站（方案 §6）：回收站只存 localStorage 里的记录，恢复时照片已不在，会留下空壳主题 */
  await WB.idb.del(IMG_KEY(rec.id));
  await WB.idb.del(THUMB_KEY(rec.id));
  invalidate(rec.id);
  saveAll(list().filter(r => r.id !== rec.id));
  /* 正在用这套：先切回内置亮色主题再删（否则 apply() 拿不到记录，会走一遍降级提示） */
  if(WB.theme.get("theme") === PREFIX + rec.id) WB.theme.set("theme", WB.theme.fallbackLight());
  return true;
}

/* ============================ 生效路径（apply / 预览 / 壁纸） ============================ */
/* 应用一套：主题字段一改，apply() 就会写档位、写 token、挂照片 */
function use(rec, {toast = true} = {}){
  if(!WB.ui.lock("theme", 700)) return false;      // 与 D 键同一个冷却闸门（方案 §5 坑④）
  const id = PREFIX + (typeof rec === "string" ? bare(rec) : rec.id);
  const rec2 = find(id);
  if(!rec2){ WB.ui.toast("这套主题已经不在了", "warn"); return false; }
  const before = WB.theme.get("theme");
  WB.theme.set("theme", id);
  WB.store.set("lastCustom:" + rec2.base, id);     // D 键轮换用（投屏风险由开关控制）
  WB.bus.emit("view:dirty");                       // 卡片网格的"当前"高亮跟着走
  if(toast && before !== id){
    WB.ui.toast("已换上「" + rec2.name + "」", null, {
      label: "撤销",
      onClick: () => { WB.theme.set("theme", before || "light"); if(WB.router) WB.router.render(); },
    });
  }
  return true;
}

/* 预览（新建/编辑弹窗用）：写档位 + 行内 token + 这张照片当背景。
   photo 可以是 Blob（刚取色的新图）、现成的 URL（编辑时沿用旧照片）或 null（不动背景）。
   结束预览 = 调一次 WB.theme.apply()，一切按 settings 重算还原 */
let previewURL = null;
function preview(base, vars, photo){
  WB.theme.previewVars(base, vars);
  if(previewURL){ URL.revokeObjectURL(previewURL); previewURL = null; }
  if(photo instanceof Blob){
    previewURL = URL.createObjectURL(photo);
    WB.theme.paintWallpaper(previewURL);
  }else if(typeof photo === "string"){
    WB.theme.paintWallpaper(photo);
  }
}
function endPreview(){
  if(previewURL){ URL.revokeObjectURL(previewURL); previewURL = null; }
  WB.theme.apply();
}

/* ============================ 管理 UI（设置页「外观」卡内） ============================ */
function actionsMenu(rec){
  let m;
  const box = el("div");
  const item = (ic, label, danger, fn) => el("button", {
    class: "btn ghost" + (danger ? " danger" : ""),
    style: {width: "100%", justifyContent: "flex-start", marginBottom: "6px"},
    html: icon(ic, 15) + "<span>" + label + "</span>",
    onclick: () => { m.close(); fn(); },
  });
  box.appendChild(item("edit", "改名", false, () => renameDialog(rec)));
  box.appendChild(item("image", "换照片（重新取色）", false, () => replacePhoto(rec)));
  box.appendChild(item("droplet", "改强调色", false, () => accentDialog(rec)));
  box.appendChild(item("trash", "删除这套主题（照片一起删）", true, () => removeDialog(rec)));
  box.appendChild(el("div", {class: "small faint", style: {marginTop: "4px"},
    text: rec.createdAt ? "建于 " + new Date(rec.createdAt).toLocaleString() : ""}));
  m = WB.ui.modal({title: rec.name, icon: "palette", content: box});
}

function renameDialog(rec){
  const input = el("input", {class: "input", value: rec.name, maxlength: 16, style: {width: "100%"}});
  let m;
  const box = el("div",
    el("div", {class: "small faint", text: "名字最多 16 个字，只影响显示"}),
    input);
  /* 带 onClick 的动作**不会自动关**（06-ui.js:176：由调用方负责关），必须自己 m.close() */
  m = WB.ui.modal({title: "给这套主题改个名字", icon: "edit", content: box, actions: [
    {label: "取消", onClick: () => m.close()},
    {label: "保存", primary: true, onClick: () => {
      m.close();
      update(rec.id, {name: input.value}).then(() => { WB.router.render(); });
    }},
  ]});
  setTimeout(() => { input.focus(); input.select(); }, 60);
}

function accentDialog(rec){
  const varsOf = hex => derive(rec.base, hex).vars;
  const input = el("input", {type: "color", value: rec.accent || (rec.seed && rec.seed.accent) || FALLBACK_ACCENT[rec.base],
    style: {width: "56px", height: "34px", padding: "0", border: "none", background: "none", cursor: "pointer"}});
  const strip = el("div", {class: "ct-strip", style: {height: "10px", marginTop: "10px"}});
  const draw = hex => {
    const v = varsOf(hex);
    strip.innerHTML = "";
    ["--bg", "--card", "--ink", "--ink-3", "--accent", "--accent-2"].forEach(k => {
      strip.appendChild(el("i", {style: {background: v[k]}}));
    });
  };
  input.addEventListener("input", () => draw(input.value));
  draw(input.value);
  const box = el("div",
    el("div", {class: "small faint", text: "换强调色会重算整套配色（背景、卡片、文字都跟着走），照片不变"}),
    el("div", {class: "row", style: {alignItems: "center", gap: "10px", marginTop: "8px"}},
      el("span", {class: "small", text: "强调色"}), input),
    strip);
  const m = WB.ui.modal({title: "改强调色", icon: "droplet", content: box, actions: [
    {label: "取消", onClick: () => m.close()},
    {label: "保存", primary: true, onClick: () => {
      m.close();
      update(rec.id, {accent: input.value}).then(() => { WB.router.render(); });
    }},
  ]});
}

function removeDialog(rec){
  WB.ui.confirmBox("删除「" + WB.esc(rec.name) + "」？<br>配色与照片会一起删掉，<b>不可恢复</b>（不进回收站）。", {
    title: "删除照片主题", okLabel: "删除", danger: true,
  }).then(ok => {
    if(!ok) return;
    del(rec.id).then(() => {
      WB.ui.toast("已删除「" + rec.name + "」");
      WB.router.render();
    });
  });
}

function replacePhoto(rec){
  pickFile(file => {
    WB.ui.toast("正在取色…");
    source(file).then(src => {
      editor(rec, src);
    }).catch(e => {
      console.error("[theme] 换照片", e);
      WB.ui.toast("这张照片读不出来，请转成 JPG / PNG 再上传", "warn");
    });
  });
}

function pickFile(cb){
  const f = el("input", {type: "file", accept: "image/*", style: {display: "none"}});
  f.addEventListener("change", () => { const file = f.files[0]; if(file) cb(file); });
  document.body.appendChild(f);
  f.click();
}

/* ---------- 编辑器：新建与编辑共用一个弹窗（选照片 → 取色 → 预览确认） ----------
   变量只有一份：base / accent / photo。任何一项改动都重算 derive() 并**立刻预览**整页
   （预览 = 写行内 token，取消时 apply() 一调用就还原，不需要"撤销预览"的专门逻辑） */
function editor(rec, src){
  let base = rec ? rec.base : src.base;
  let accent = rec ? (rec.accent || rec.seed.accent) : src.accent;
  let photoBlob = src ? src.photo : null;
  let thumbBlob = src ? src.thumb : null;
  let thumbURL = null;
  let saved = false;

  const nameInput = el("input", {class: "input", value: rec ? rec.name : "", maxlength: 16,
    placeholder: "给这套主题起个名字", style: {width: "100%"}});
  const thumb = el("div", {class: "ct-thumb", style: {height: "96px",
    background: "linear-gradient(135deg, var(--bg-2), var(--accent-soft))"}});
  const strip = el("div", {class: "ct-strip", style: {height: "12px", marginTop: "4px"}});
  const tag = el("span", {class: "chip plain", text: ""});
  const baseSeg = el("div", {class: "seg"});
  [["light", "浅色底"], ["dark", "深色底"]].forEach(([v, label]) => {
    const b = el("button", {class: v === base ? "on" : "", text: label, onclick: () => {
      base = v;
      Array.from(baseSeg.children).forEach((n, i) => n.classList.toggle("on", ["light", "dark"][i] === base));
      refresh();
    }});
    baseSeg.appendChild(b);
  });
  const accentInput = el("input", {type: "color", value: accent,
    style: {width: "46px", height: "32px", padding: "0", border: "none", background: "none", cursor: "pointer"}});
  accentInput.addEventListener("input", () => { accent = accentInput.value; refresh(); });
  const grayHint = el("div", {class: "small faint", style: {display: "none"},
    text: "这张照片没什么艳色，先按档位给了个默认强调色 —— 也可以自己挑一个"});

  /* 缩略图：新建用刚压缩好的 blob；编辑先用 IDB 里的旧图，换照片后立刻换成新的 */
  const setThumb = blob => {
    if(thumbURL) URL.revokeObjectURL(thumbURL);
    thumbURL = URL.createObjectURL(blob);
    thumb.style.backgroundImage = "url(" + thumbURL + ")";
    thumb.style.backgroundSize = "cover";
    thumb.style.backgroundPosition = "center";
  };
  if(thumbBlob) setThumb(thumbBlob);
  else if(rec) photoURL(rec.id, true).then(u => { if(u) thumb.style.backgroundImage = "url(" + u + ")"; });
  /* 编辑旧主题时先把大图读进缓存：预览才有背景可看（读不到就只预览配色，不报错） */
  if(rec && !photoBlob) photo(rec.id).then(u => { if(u && !photoBlob) preview(base, derive(base, accent).vars, u); });

  function refresh(){
    const d = derive(base, accent);
    strip.innerHTML = "";
    ["--bg", "--card", "--ink", "--ink-3", "--accent", "--accent-2"].forEach(k => {
      strip.appendChild(el("i", {style: {background: d.vars[k]}}));
    });
    tag.textContent = base === "dark" ? "深色底 · 暗色框架" : "浅色底 · 亮色框架";
    tag.className = "chip " + (base === "dark" ? "" : "plain");
    grayHint.style.display = (src && src.gray && !rec) ? "" : "none";
    /* 背景：新建 / 刚换过照片用新图；编辑旧主题沿用 IDB 里那张（命中缓存就直接复用，不重复建 URL） */
    preview(base, d.vars, photoBlob || (rec ? cached(rec.id) : null));
  }

  const body = el("div",
    el("div", {class: "small faint", text: rec ? "点「换照片」可以重新取色；改档位或强调色会立刻预览整页效果" : "照片已取色完成，下面可以微调；此刻页面就是预览效果"}),
    el("div", {style: {marginTop: "10px"}}, thumb),
    strip,
    el("div", {class: "row", style: {alignItems: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap"}},
      el("span", {class: "small", text: "明暗基底"}), baseSeg, tag),
    el("div", {class: "row", style: {alignItems: "center", gap: "10px", marginTop: "8px"}},
      el("span", {class: "small", text: "强调色"}), accentInput,
      el("button", {class: "btn sm ghost", html: icon("image", 14) + "<span>换照片</span>",
        onclick: () => pickFile(file => {
          WB.ui.toast("正在取色…");
          source(file).then(s2 => {
            photoBlob = s2.photo; thumbBlob = s2.thumb;
            base = s2.base; accent = s2.accent;
            accentInput.value = accent;
            Array.from(baseSeg.children).forEach((n, i) => n.classList.toggle("on", ["light", "dark"][i] === base));
            setThumb(thumbBlob);
            refresh();
            WB.ui.toast("已重新取色");
          }).catch(() => WB.ui.toast("这张照片读不出来，请转成 JPG / PNG 再上传", "warn"));
        })})),
    grayHint,
    el("div", {style: {marginTop: "12px"}},
      el("div", {class: "small faint", text: "名字"}),
      nameInput),
    el("div", {class: "small faint", style: {marginTop: "10px"},
      text: "照片只存在这台设备（IndexedDB），不会同步，也不会包含在 JSON 备份里"})
  );

  /* 带 onClick 的动作不会自动关（06-ui.js:176）：两个都要自己 m.close()。
     「保存并应用」先起异步建档再关窗 —— saved 必须在这一刻就置位，
     否则 onClose 会把刚保存的主题当成"取消"给还原掉 */
  const m = WB.ui.modal({
    title: rec ? "编辑照片主题" : "新建照片主题", icon: "palette", content: body, wide: true,
    actions: [
      {label: "取消", onClick: () => m.close()},
      {label: "保存并应用", primary: true, onClick: () => {
        saved = true;
        const patch = {name: nameInput.value, base, accent, photo: photoBlob, thumb: thumbBlob};
        const done = rec ? update(rec.id, patch) : create(patch);
        m.close();
        done.then(r => {
          if(!r){ WB.ui.toast("存不下了：本地空间不足，先删几套再试", "warn"); WB.theme.apply(); return; }
          use(r);          // 换过照片的缓存失效在 update() 里做（延迟 revoke）
          WB.router.render();
        }).catch(e => {
          console.error("[theme] 保存", e);
          WB.ui.toast("保存失败，照片可能太大", "warn");
          WB.theme.apply();
        });
      }},
    ],
    onClose: () => {
      if(thumbURL){ URL.revokeObjectURL(thumbURL); thumbURL = null; }
      if(saved) return;         // 已保存：主题已换成新的，apply() 由 use() 触发
      endPreview();             // 取消/点遮罩：结束预览，回到原主题
    },
  });
  refresh();
}

function newTheme(){
  if(list().length >= MAX){
    WB.ui.toast("最多 " + MAX + " 套，先删掉一套再建", "warn");
    return;
  }
  pickFile(file => {
    WB.ui.toast("正在取色…");
    source(file).then(src => { editor(null, src); })
      .catch(e => {
        console.error("[theme] 新建", e);
        WB.ui.toast("这张照片读不出来，请转成 JPG / PNG 再上传", "warn");
      });
  });
}

/* 设置页「外观」卡里的一块：标题 + 卡片网格 + 上传底线说明 */
function manageBlock(){
  const box = el("div", {style: {padding: "10px 0", borderTop: "1px dashed var(--card-border)"}});
  const grid = el("div", {class: "ct-grid", style: {marginTop: "10px"}});
  const addBtn = el("button", {class: "btn sm", html: icon("plus", 14) + "<span>新建</span>", onclick: newTheme});
  box.appendChild(el("div", {class: "row", style: {alignItems: "center", gap: "10px", flexWrap: "wrap"}},
    el("div", {class: "grow"},
      el("div", {text: "我的主题", style: {fontSize: "14.5px"}}),
      el("div", {class: "small faint", text: "上传一张照片 → 自动取出整套配色，照片同时成为背景（上限 " + MAX + " 套）"})),
    addBtn));
  box.appendChild(grid);

  const render = () => {
    grid.innerHTML = "";
    const recs = list();
    const cur = WB.theme.get("theme");
    if(!recs.length){
      grid.appendChild(el("div", {class: "small faint", style: {padding: "2px 0"},
        text: "还没有照片主题 —— 点「新建」传一张照片试试"}));
      return;
    }
    recs.forEach(rec => {
      const seed = rec.seed || derive(rec.base, rec.accent).seed;
      const card = el("div", {class: "ct-card" + (cur === PREFIX + rec.id ? " on" : ""),
        role: "button", tabindex: "0", title: "点击应用「" + rec.name + "」"});
      const th = el("div", {class: "ct-thumb",
        style: {background: "linear-gradient(135deg," + seed.bg + "," + seed.accent + ")"}});
      photoURL(rec.id, true).then(u => {
        if(!u) return;
        th.style.backgroundImage = "url(" + u + ")";
        th.classList.add("has-img");
      });
      const more = el("button", {class: "ct-more icon-btn", html: icon("dots", 14),
        "aria-label": "更多操作", onclick: e => { e.stopPropagation(); actionsMenu(rec); }});
      card.appendChild(el("div", {class: "ct-body"},
        th,
        el("div", {class: "ct-name", text: rec.name}),
        el("div", {class: "ct-strip"},
          el("i", {style: {background: seed.bg}}),
          el("i", {style: {background: seed.card}}),
          el("i", {style: {background: seed.accent}}))));
      card.appendChild(more);
      card.addEventListener("click", () => use(rec));
      card.addEventListener("keydown", e => {
        if(e.key === "Enter" || e.key === " "){ e.preventDefault(); use(rec); }
      });
      grid.appendChild(card);
    });
  };
  render();
  /* 跨标签页改动不用在这里订阅：09-router.js 的 store:external → render() 会整页重绘 */
  return box;
}

/* 启动：清掉没人引用的照片（清过 localStorage / 导入过别人的备份时会留下孤儿 key） */
async function init(){
  try{
    const ids = new Set(list().map(r => r.id));
    const keys = await WB.idb.allKeys("theme:");
    for(const k of keys){
      const id = String(k).replace(/^theme:/, "").replace(/:thumb$/, "");
      if(!ids.has(id)){ await WB.idb.del(k); console.info("[theme] 清理孤儿照片", k); }
    }
  }catch(e){ console.error("[theme] 孤儿清理", e); }
}

WB.customTheme = {
  VARS, MAX, PREFIX, KEY, list, find, has, bare, resolve, derive, pickPalette, source,
  create, update, del, photoURL, cached, photo, revoke, invalidate, use, preview, endPreview,
  init, manageBlock, editor, newTheme,
};
})();

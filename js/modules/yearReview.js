/* modules/yearReview.js —— 晨雾年报：Wrapped 式年度回顾（全本地数据 + canvas 分享卡）
   无路由模块：不进侧栏，入口 = ⌘K「晨雾年报」/ 12 月总览按钮；file:// 与单文件版天然兼容 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;

const MOOD_FACE = ["", "😟", "😕", "😐", "🙂", "😊"];
const MOOD_CN = ["", "有点糟", "一般般", "平静", "不错", "很好"];

/* 数据全部现场统计，不落库；口径与统计页一致（待办按 t.date 归日，无 doneAt 时间戳） */
function gather(year){
  const inYear = s => typeof s === "string" && s.slice(0, 4) === year;
  const done = WB.store.get("todos", []).filter(t => t.done && inYear(t.date));
  const byDay = {};
  done.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + 1; });
  const topDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;

  const pomo = WB.store.get("pomoLog", []).filter(l => l.status === "done" && l.mode === "focus" && inYear(l.date));
  const pomoMin = pomo.reduce((s, l) => s + (l.minutes || 0), 0);

  const byHabit = {};
  WB.store.get("habitLogs", []).forEach(l => {
    if(inYear(l.date) && l.count > 0) byHabit[l.habitId] = (byHabit[l.habitId] || 0) + 1;
  });
  let topHabit = null;
  Object.entries(byHabit).sort((a, b) => b[1] - a[1]).some(([id, n]) => {
    const h = WB.store.get("habits", []).find(x => x.id === id);
    if(h){ topHabit = {name: h.name, days: n}; return true; }
    return false;
  });

  const moods = WB.store.get("moods", []).filter(m => inYear(m.date));
  const moodCnt = [0, 0, 0, 0, 0, 0];
  moods.forEach(m => { moodCnt[Math.min(5, Math.max(1, m.level || 3))]++; });
  const topMood = moodCnt.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1])[0];

  const journals = WB.store.get("journals", []).filter(j => inYear(j.date));
  const words = journals.reduce((s, j) =>
    s + ((j.done || "") + (j.problems || "") + (j.plan || "") + (j.free || "") + (j.answer || "")).length, 0);

  const ledger = WB.store.get("ledger", []).filter(l => inYear(l.date));
  const outSum = ledger.filter(l => l.type === "out").reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const byCat = {};
  ledger.filter(l => l.type === "out").forEach(l => { byCat[l.catId] = (byCat[l.catId] || 0) + (Number(l.amount) || 0); });
  const topCatEntry = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  const topCat = topCatEntry ? ((WB.store.get("ledgerCats", []).find(c => c.id === topCatEntry[0]) || {}).name || "") : "";

  /* 关键词取结构化数据（笔记标签 + 日志标签 + 习惯名），不做中文分词猜测 */
  const kw = {};
  WB.store.get("notes", []).forEach(n => (n.tags || []).forEach(tg => { if(tg) kw[tg] = (kw[tg] || 0) + 1; }));
  journals.forEach(j => (j.tags || []).forEach(tg => { if(tg) kw[tg] = (kw[tg] || 0) + 1; }));
  WB.store.get("habits", []).forEach(h => { if(!h.archived && h.name) kw[h.name] = (kw[h.name] || 0) + 2; });
  const keywords = Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

  const first = WB.theme.get("firstSeenTs") || 0;
  return {doneCount: done.length, topDay, pomoCount: pomo.length, pomoMin, topHabit,
    moodCount: moods.length, topMoodIdx: topMood[0], topMoodN: topMood[1],
    journals: journals.length, words, outSum, inSum: ledger.filter(l => l.type === "in").reduce((s, l) => s + (Number(l.amount) || 0), 0),
    topCat, keywords,
    days: first ? Math.max(1, Math.floor((Date.now() - first) / 86400000)) : 0};
}

function fmtMin(min){
  return min >= 60 ? Math.floor(min / 60) + " 小时" + (min % 60 ? " " + (min % 60) + " 分" : "") : min + " 分钟";
}
function fmtMoney(n){
  return n >= 10000 ? (n / 10000).toFixed(1) + " 万" : String(Math.round(n));
}

/* ---------- 年度卡片（canvas 分享图，手法同今日纪念卡） ---------- */
function drawCard(year, s){
  const W = 720, H = 1000;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const FONT = '"LXGW WenKai Subset","LXGW WenKai","Microsoft YaHei",sans-serif';
  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, W, H);
  const blob = (x, y, r, c) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, c); g.addColorStop(1, "rgba(247,242,232,0)");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(120, 170, 300, "rgba(127,163,189,.30)");
  blob(620, 320, 260, "rgba(176,160,209,.26)");
  blob(560, 880, 320, "rgba(238,196,168,.22)");
  blob(80, 760, 220, "rgba(127,163,189,.16)");

  ctx.textAlign = "center";
  ctx.fillStyle = "#7fa3bd";
  ctx.font = "26px " + FONT;
  ctx.fillText("MORNING MIST · 年度回顾", W / 2, 118);
  ctx.fillStyle = "#4a4a5a";
  ctx.font = "600 104px " + FONT;
  ctx.fillText(year, W / 2, 240);
  ctx.fillStyle = "#8a8a9a";
  ctx.font = "24px " + FONT;
  ctx.fillText(s.days ? "这一年，小雾团陪了你 " + s.days + " 天" : "晨雾奶油 · 个人工作台", W / 2, 292);

  const rows = [];
  if(s.doneCount) rows.push(["完成待办", s.doneCount + " 件"]);
  if(s.pomoMin) rows.push(["专注", fmtMin(s.pomoMin) + " · " + s.pomoCount + " 个番茄"]);
  if(s.topHabit) rows.push(["最坚持的习惯", "「" + s.topHabit.name + "」" + s.topHabit.days + " 天"]);
  if(s.journals) rows.push(["写下", s.journals + " 篇日志 · " + s.words + " 字"]);
  if(s.outSum) rows.push(["记账", "支出 ¥" + fmtMoney(s.outSum) + (s.topCat ? " · 最多花在「" + s.topCat + "」" : "")]);
  if(s.moodCount) rows.push(["心情", "有 " + s.moodCount + " 天在记录，最常见的是" + MOOD_CN[s.topMoodIdx] + " " + MOOD_FACE[s.topMoodIdx]]);
  if(s.topDay && s.topDay[1] >= 3) rows.push(["最勤奋的一天", s.topDay[0].slice(5).replace("-", " 月 ") + " 日 · 完成 " + s.topDay[1] + " 件"]);

  ctx.strokeStyle = "rgba(127,163,189,.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(140, 330); ctx.lineTo(580, 330); ctx.stroke();
  const rowH = Math.min(78, 470 / Math.max(rows.length, 1));
  rows.forEach(([k, v], i) => {
    const y = 396 + i * rowH;
    ctx.textAlign = "left";
    ctx.fillStyle = "#a0a0b0";
    ctx.font = "20px " + FONT;
    ctx.fillText(k, 120, y);
    ctx.fillStyle = "#4a4a5a";
    ctx.font = "600 30px " + FONT;
    ctx.fillText(v, 120, y + 36);
  });
  if(s.keywords.length){
    const y = 396 + rows.length * rowH + 34;
    ctx.textAlign = "center";
    ctx.fillStyle = "#7fa3bd";
    ctx.font = "600 26px " + FONT;
    ctx.fillText(s.keywords.map(k => "#" + k).join("  "), W / 2, Math.min(y, 900));
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#b0a8b8";
  ctx.font = "22px " + FONT;
  ctx.fillText("明天也要好好过 ✦", W / 2, 918);
  ctx.font = "18px " + FONT;
  ctx.fillText("晨雾奶油 · 个人工作台", W / 2, 956);
  return cv;
}

/* ---------- 年报页（大 modal，内容纵向叙事，空节自动隐藏） ---------- */
function open(year){
  year = String(year || new Date().getFullYear());
  const s = gather(year);
  const hasAny = s.doneCount || s.pomoMin || s.journals || s.moodCount || s.outSum || s.topHabit;
  const content = el("div", {class: "col", style: {gap: "18px", padding: "4px 2px"}});

  content.appendChild(el("div", {class: "center col", style: {gap: "6px"}},
    el("div", {class: "yr-year", text: year}),
    el("div", {class: "small faint", text: s.days
      ? "小雾团陪你的第 " + s.days + " 天 · 下面是这一年留下的痕迹"
      : "这一年的痕迹都还在本地，随时可查"})));

  if(!hasAny){
    content.appendChild(WB.ui.emptyState("sparkle", year + " 年的故事还没开始写",
      "记下的每一天都会算数：待办、专注、日志、心情、账单——年底回来看，会很有意思。"));
  }else{
    const sec = (label, value, note) => content.appendChild(el("div", {class: "yr-sec"},
      el("div", {class: "yr-label", text: label}),
      el("div", {class: "yr-value", text: value}),
      note ? el("div", {class: "small faint", text: note}) : null));
    if(s.doneCount) sec("完成待办", s.doneCount + " 件",
      s.topDay && s.topDay[1] >= 3 ? "最勤奋的一天是 " + s.topDay[0].slice(5).replace("-", " 月 ") + " 日，完成 " + s.topDay[1] + " 件" : null);
    if(s.pomoMin) sec("专注时光", fmtMin(s.pomoMin), "共 " + s.pomoCount + " 个番茄，雾团都看在眼里");
    if(s.topHabit) sec("最坚持的习惯", "「" + s.topHabit.name + "」", "今年打卡 " + s.topHabit.days + " 天");
    if(s.moodCount) sec("心情气候", MOOD_FACE[s.topMoodIdx] + " 最常见的是「" + MOOD_CN[s.topMoodIdx] + "」",
      "有 " + s.moodCount + " 天记录了心情");
    if(s.journals) sec("写下的字", s.words + " 字", "散在 " + s.journals + " 篇日志里");
    if(s.outSum || s.inSum) sec("账本", "支出 ¥" + fmtMoney(s.outSum) + (s.inSum ? " · 收入 ¥" + fmtMoney(s.inSum) : ""),
      s.topCat ? "花得最多的是「" + s.topCat + "」" : null);
    if(s.keywords.length) sec("今年的关键词", s.keywords.map(k => "#" + k).join("  "), null);
    content.appendChild(el("div", {class: "center col", style: {gap: "4px"}},
      el("div", {class: "yr-bye", text: "明天也要好好过 ✦"})));
  }

  const actions = [];
  if(hasAny) actions.push({label: "保存年度卡片", primary: true, onClick: () => {
    drawCard(year, s).toBlob(b => WB.downloadFile("晨雾年报-" + year + ".png", b, "image/png"));
    WB.ui.toast("年度卡片已保存到下载");
    return true;
  }});
  actions.push({label: "关闭"});

  WB.ui.modal({title: "晨雾年报", icon: "sparkle", content, actions});
}

WB.yearReview = {open};
})();

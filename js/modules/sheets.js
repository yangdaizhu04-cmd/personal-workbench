/* modules/sheets.js —— 「纸」：日 / 周 / 月 / 季 / 年 五张能落到纸上的页
   来源：第五轮方案主线 🅑「时间的节拍」（2026-09-23）。每一级配一份**能带走的产出物**：
   日=一页纸 / 周=周页 / 月=月历海报（贴墙）/ 季=季刊页 / 年=年刊。

   工程约定（改这里前先读这段）：
   · **不引 PDF 库**：只用一套 `@media print` 样式 + `window.print()`（见 main.css「打印」段），
     用户在打印对话框里选「另存为 PDF」即可带走 —— 零依赖，符合本地优先
   · 打印时只留 `#sheet-viewer`：`body > *:not(#sheet-viewer)` 全部 display:none，
     所以浮层里的纸就是唯一会被印出来的东西
   · **颜色要印得出来**：纸张与心情色块都加 print-color-adjust:exact，
     否则浏览器省墨模式会把色块全部刷白，月历海报就成了一张白纸
   · 纸张尺寸 210mm×297mm（A4 纵向），窄屏自动改为整宽单栏（屏幕上只是预览）
   · 数据全部现场算、不落库（与年报同口径：待办按 `t.date` 归日）
   · 五张纸共用一套排版原子：`.paper-head / .p-sec / .p-kpi / .p-grid / .p-bar / .p-foot` */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;

const MOOD_FACE = ["", "😟", "😕", "😐", "🙂", "😊"];
const MOOD_CN = ["", "有点糟", "一般般", "平静", "不错", "很好"];
/* 打印用的心情底色：低饱和到能当纸用，但一眼看得出起伏（1 偏灰粉 → 5 偏清透） */
const MOOD_TINT = ["", "#e6d5d2", "#e9dccb", "#ece5d8", "#dde7dc", "#d2e1e6"];

let viewer = null, paperEl = null, openKind = null;

/* ---------- 取数 ---------- */
const todosOn = d => WB.store.get("todos", []).filter(t => t.date === d);
const doneOn = d => todosOn(d).filter(t => t.done);
const pomoOn = d => WB.store.get("pomoLog", []).filter(l => l.date === d && l.status === "done" && l.mode === "focus");
const moodOn = d => WB.store.get("moods", []).find(m => m.date === d) || null;
const journalOn = d => WB.store.get("journals", []).find(j => j.date === d) || null;
const spendOn = d => WB.store.get("ledger", []).filter(l => l.date === d && l.type === "out")
  .reduce((s, l) => s + (Number(l.amount) || 0), 0);
const habitLogsOn = d => WB.store.get("habitLogs", []).filter(l => l.date === d && l.count > 0);
const habitName = id => (WB.store.get("habits", []).find(h => h.id === id) || {}).name || "习惯";
const rangeDays = (a, b) => {
  const out = [];
  for(let d = a; d <= b; d = WB.addDaysStr(d, 1)) out.push(d);
  return out;
};
function fmtMoney(n){ return "¥" + (Math.round(n * 100) / 100); }
function fmtMin(min){ return min >= 60 ? Math.floor(min / 60) + " 小时" + (min % 60 ? " " + min % 60 + " 分" : "") : min + " 分钟"; }
function dayCN(ds){
  const d = WB.parseDate(ds);
  return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
}

/* ---------- 排版原子 ---------- */
function head(title, sub, right){
  return el("div", {class: "paper-head"},
    el("div", {},
      el("h1", {text: title}),
      sub ? el("div", {class: "p-sub", text: sub}) : null),
    right ? el("div", {class: "p-head-right", text: right}) : null);
}
function sec(title, ...nodes){
  const box = el("div", {class: "p-sec"});
  if(title) box.appendChild(el("h2", {text: title}));
  nodes.forEach(n => n && box.appendChild(n));
  return box;
}
function kpi(items){
  const g = el("div", {class: "p-kpi"});
  items.forEach(([label, val]) => g.appendChild(el("div", {},
    el("b", {text: String(val)}), el("span", {text: label}))));
  return g;
}
function bar(pct, color){
  const i = el("i", {style: {width: Math.max(0, Math.min(100, pct)) + "%"}});
  if(color) i.style.background = color;
  return el("div", {class: "p-bar"}, i);
}
function line(text, cls){ return el("div", {class: cls || "", text: text}); }

/* ---------- 纸 ①：一页纸（某一天） ---------- */
function paperDay(dateStr){
  dateStr = dateStr || WB.bizDate();
  const d = WB.parseDate(dateStr);
  const big3 = WB.store.get("bigThree:" + dateStr, []);
  const done = doneOn(dateStr), all = todosOn(dateStr), pomo = pomoOn(dateStr);
  const pomoMin = pomo.reduce((s, l) => s + (l.minutes || 0), 0);
  const mood = moodOn(dateStr), j = journalOn(dateStr);
  const logs = habitLogsOn(dateStr);
  const mem = WB.store.get("companion:" + dateStr, null);
  const hol = WB.cal.holidayOf(dateStr);
  const lunar = WB.cal.lunarOf(dateStr);
  const term = WB.cal.termOf(dateStr);
  const fest = WB.cal.festivalOf(dateStr);

  const sub = [lunar ? "农历 " + lunar.monthCn + lunar.dayCn : "", fest || "",
    term && term.isTermDay ? term.name : "", hol ? (hol.type === "休" ? hol.name + " · 休" : "调休上班") : ""]
    .filter(Boolean).join(" · ");

  const card = el("div", {class: "paper"});
  /* 晨雾指数只对"今天"有完整口径（历史某天的逾期状态无法复原），为 0 时干脆不写，
     免得纸上出现一个看起来像坏掉的「晨雾指数 0」 */
  const karma = WB.karmaDay ? WB.karmaDay(dateStr) : 0;
  card.appendChild(head(dayCN(dateStr) + " " + WB.WEEK_CN[d.getDay()], sub,
    karma > 0 ? "晨雾指数 " + karma : ""));

  card.appendChild(sec("今天的三大件", (() => {
    if(!big3.length) return line("（这天没有圈重点）", "p-dim");
    const box = el("div", {class: "p-list"});
    big3.forEach(it => box.appendChild(el("div", {},
      el("span", {class: "p-tick", text: it.done ? "☑" : "☐"}),
      el("span", {text: " " + (it.text || it.title || "")}))));
    return box;
  })()));

  card.appendChild(sec("做完的事（" + done.length + "/" + all.length + "）", (() => {
    if(!done.length) return line("（这天还没打勾的条目）", "p-dim");
    const box = el("div", {class: "p-list"});
    done.forEach(t => box.appendChild(el("div", {class: "p-row"},
      el("span", {text: "☑ " + t.title}),
      el("span", {class: "p-dim", text: [t.time || "", t.list || ""].filter(Boolean).join(" · ")}))));
    return box;
  })()));

  card.appendChild(sec("这一天的数", kpi([
    ["完成 / 计划", done.length + " / " + all.length],
    ["专注", pomoMin ? fmtMin(pomoMin) : "0"],
    ["番茄", pomo.length + " 个"],
    ["支出", fmtMoney(spendOn(dateStr))],
  ])));

  const rec = [];
  if(mood) rec.push(line("心情：" + MOOD_FACE[mood.level] + " " + (MOOD_CN[mood.level] || "") + (mood.note ? " —— " + mood.note : "")));
  if(logs.length) rec.push(line("打卡：" + logs.map(l => habitName(l.habitId) + (l.count > 1 ? "×" + l.count : "")).join("、")));
  /* 打断也落在纸上：纸上留这一行，是承认"被打断"本来就是一天的一部分 */
  const ints = WB.store.get("interrupts", []).filter(x => x.date === dateStr);
  if(ints.length){
    const kinds = WB.pomodoro && WB.pomodoro.INTERRUPT_KINDS || [];
    const top = Object.entries(ints.reduce((a, x) => (a[x.kind] = (a[x.kind] || 0) + 1, a), {}))
      .sort((a, b) => b[1] - a[1])[0];
    const lab = (kinds.find(k => k.id === top[0]) || {}).label || top[0];
    rec.push(line("被打断 " + ints.length + " 次（多是「" + lab + "」）"));
  }
  if(rec.length) card.appendChild(sec("状态", ...rec));

  if(j && (j.done || j.problems || j.plan || j.free || j.answer)){
    const box = el("div", {class: "p-journal"});
    [["今天完成", j.done], ["遇到问题", j.problems], ["明日计划", j.plan]].forEach(([k, v]) => {
      if(v) box.appendChild(el("div", {}, el("b", {text: k + "："}), el("span", {text: v})));
    });
    if(j.free) box.appendChild(el("div", {class: "p-quote", text: j.free.slice(0, 400) + (j.free.length > 400 ? "…" : "")}));
    if(j.answer) box.appendChild(el("div", {class: "p-dim"},
      el("span", {text: "今日一问：" + (j.question || "") + " —— "}), el("span", {text: j.answer})));
    card.appendChild(sec("记下的字", box));
  }

  if(mem && mem.line) card.appendChild(sec("它记得的日子", el("div", {class: "p-quote", text: mem.line})));

  card.appendChild(el("div", {class: "p-foot",
    text: "个人工作台 · " + dateStr + " · 打印于 " + WB.todayStr()}));
  return card;
}

/* ---------- 纸 ②：周页 ---------- */
function paperWeek(weekStart){
  weekStart = weekStart || WB.stats.weekStartOf(WB.bizDate());
  /* 数字一律**现场重算**，存档里那只取「我写的周总结」——
     存档是周初就冻结的（ensureWeekly），本周还在长，取它会出现"KPI 全是 0、逐日表却有数"
     这种自相矛盾的纸（与踩坑 #073 同一个错法：数据会长，就不能只认冻结的那份） */
  const live = WB.stats.buildWeeklyReport(weekStart);
  const stored = WB.store.get("weekReports", []).find(r => r.weekStart === weekStart);
  const rep = Object.assign({}, live, {summary: (stored && stored.summary) || ""});
  const days = rangeDays(weekStart, WB.addDaysStr(weekStart, 6));
  const card = el("div", {class: "paper"});
  card.appendChild(head("这一周 · " + dayCN(weekStart) + " – " + dayCN(days[6]),
    "周一至周日 · 共 " + days.length + " 天",
    Number(weekStart.slice(5, 7)) + " 月 · 第 " +
    (Math.floor((WB.parseDate(weekStart).getDate() - 1) / 7) + 1) + " 周"));

  card.appendChild(sec("四个数", kpi([
    ["完成 / 创建", rep.done + " / " + rep.created],
    ["专注", rep.focusMin ? fmtMin(rep.focusMin) : "0"],
    ["平均心情", rep.moodAvg ? rep.moodAvg + " / 5" : "未记录"],
    ["支出", fmtMoney(rep.spend)],
  ])));

  card.appendChild(sec("它的评语", el("div", {class: "p-quote", text: rep.comment || "—"})));

  const t = el("div", {class: "p-table"});
  t.appendChild(el("div", {class: "p-tr p-th"},
    el("span", {text: "日期"}), el("span", {text: "完成/计划"}), el("span", {text: "专注"}), el("span", {text: "心情"})));
  days.forEach(ds => {
    const done = doneOn(ds).length, all = todosOn(ds).length;
    const min = pomoOn(ds).reduce((s, l) => s + (l.minutes || 0), 0);
    const m = moodOn(ds);
    t.appendChild(el("div", {class: "p-tr"},
      el("span", {text: dayCN(ds) + " " + WB.WEEK_CN[WB.parseDate(ds).getDay()]}),
      el("span", {text: done + " / " + all}),
      el("span", {text: min ? min + " 分" : "—"}),
      el("span", {text: m ? MOOD_FACE[m.level] + " " + MOOD_CN[m.level] : "—"})));
  });
  card.appendChild(sec("逐日", t));

  if(rep.summary) card.appendChild(sec("我写的周总结", el("div", {class: "p-quote", text: rep.summary})));
  card.appendChild(el("div", {class: "p-foot", text: "个人工作台 · 周页 · " + weekStart + " 起 · 打印于 " + WB.todayStr()}));
  return card;
}

/* ---------- 纸 ③：月历海报（贴墙） ---------- */
function monthCells(ym){
  const [y, m] = ym.split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  const lead = new Date(y, m - 1, 1).getDay();
  const cells = [];
  for(let i = 0; i < lead; i++) cells.push(null);
  for(let d = 1; d <= total; d++){
    const ds = ym + "-" + String(d).padStart(2, "0");
    const tm = WB.cal.termOf(ds);
    cells.push({d, ds, mood: moodOn(ds), done: doneOn(ds).length,
      log: !!journalOn(ds), hol: WB.cal.holidayOf(ds), term: tm && tm.isTermDay ? tm.name : ""});
  }
  while(cells.length % 7) cells.push(null);
  return cells;
}
/* 月历网格：月历海报与年刊的月页共用同一份（一处排版，两处复用） */
function monthGridEl(cells){
  const grid = el("div", {class: "p-grid"});
  ["日", "一", "二", "三", "四", "五", "六"].forEach(w => grid.appendChild(el("div", {class: "p-cell p-cell-h", text: w})));
  cells.forEach(c => {
    if(!c){ grid.appendChild(el("div", {class: "p-cell p-cell-empty"})); return; }
    const box = el("div", {class: "p-cell"});
    box.appendChild(el("div", {class: "p-cell-d"},
      el("span", {text: String(c.d)}),
      c.hol ? el("span", {class: "p-hol", text: c.hol.type === "休" ? "休" : "班"}) : null));
    if(c.term) box.appendChild(el("div", {class: "p-cell-tag", text: c.term}));
    if(c.done) box.appendChild(el("div", {class: "p-cell-n", text: "完成 " + c.done}));
    if(c.log) box.appendChild(el("div", {class: "p-cell-tag", text: "有日志"}));
    box.style.background = c.mood ? MOOD_TINT[c.mood.level] : "";
    grid.appendChild(box);
  });
  return grid;
}
/* 一个月的聚合：月历海报、季刊页、年刊的月页都从这里取数（口径只有一份，踩坑 #074 的教训） */
function yearMonthStat(year, m){
  const ym = year + "-" + String(m).padStart(2, "0");
  const cells = monthCells(ym);
  const days = cells.filter(Boolean);
  const moodDays = days.filter(c => c.mood);
  return {ym, m, cells, days,
    done: days.reduce((s, c) => s + c.done, 0),
    pomoMin: days.reduce((s, c) => s + pomoOn(c.ds).reduce((a, l) => a + (l.minutes || 0), 0), 0),
    spend: days.reduce((s, c) => s + spendOn(c.ds), 0),
    habitDays: days.filter(c => habitLogsOn(c.ds).length).length,
    logDays: days.filter(c => c.log).length,
    moodDays: moodDays.length,
    moodAvg: moodDays.length ? moodDays.reduce((s, c) => s + c.mood.level, 0) / moodDays.length : 0,
    active: days.filter(c => c.done || c.mood || c.log).length};
}
function paperMonth(ym){
  ym = ym || WB.monthStr(new Date());
  const st = yearMonthStat(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
  const best = st.days.slice().sort((a, b) => b.done - a.done)[0];
  const card = el("div", {class: "paper paper-poster"});
  card.appendChild(head(Number(ym.slice(0, 4)) + " 年 " + Number(ym.slice(5, 7)) + " 月",
    "有记录 " + st.active + " 天 · 这个月的形状",
    st.moodAvg ? "心情 " + MOOD_FACE[Math.round(st.moodAvg)] + " " + st.moodAvg.toFixed(1) : ""));
  card.appendChild(sec("", monthGridEl(st.cells)));
  card.appendChild(sec("这个月", kpi([
    ["完成的事", st.done + " 件"],
    ["专注", st.pomoMin ? fmtMin(st.pomoMin) : "0"],
    ["支出", fmtMoney(st.spend)],
    ["打卡天数", st.habitDays + " 天"],
  ])));
  const extra = [];
  if(best && best.done) extra.push(line("最勤的一天：" + dayCN(best.ds) + "，完成 " + best.done + " 件"));
  if(st.moodDays) extra.push(line("心情记了 " + st.moodDays + " 天，多数是「" + MOOD_CN[Math.round(st.moodAvg)] + "」"));
  if(extra.length) card.appendChild(sec("", ...extra));
  card.appendChild(el("div", {class: "p-foot", text: "个人工作台 · 月历 · " + ym + " · 打印于 " + WB.todayStr()}));
  return card;
}

/* ---------- 纸 ④：季刊页 ---------- */
function paperQuarter(year, q){
  /* 公开 API 要给默认值：`WB.sheets.open("quarter")` 应当就是"本季"。
     不给默认的下场是纸上印出「undefined 年 · 第 undefined 季」（截图复核时当场撞到） */
  const now = WB.bizDate();
  year = Number(year || now.slice(0, 4));
  q = Number(q) || (Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1);
  const startM = (q - 1) * 3 + 1;
  /* 三个月的数走 yearMonthStat（与月历海报、年刊月页同一份口径） */
  const rows = [0, 1, 2].map(i => yearMonthStat(year, startM + i));
  const sum = rows.reduce((a, r) => ({done: a.done + r.done, min: a.min + r.pomoMin, sp: a.sp + r.spend,
    active: a.active + r.active}), {done: 0, min: 0, sp: 0, active: 0});
  const maxDone = Math.max(1, ...rows.map(r => r.done));

  const card = el("div", {class: "paper"});
  card.appendChild(head(year + " 年 · 第 " + q + " 季",
    startM + " – " + (startM + 2) + " 月 · 三个月一起看", ""));

  const t = el("div", {class: "p-qtable"});
  rows.forEach(r => {
    t.appendChild(el("div", {class: "p-qrow"},
      el("div", {class: "p-qhead"},
        el("span", {text: Number(r.m.split("-")[1]) + " 月"}),
        el("span", {class: "p-dim", text: "有记录 " + r.active + " 天"})),
      bar(r.done / maxDone * 100),
      el("div", {class: "p-qnums"},
        el("span", {text: "完成 " + r.done + " 件"}),
        el("span", {text: r.pomoMin ? fmtMin(r.pomoMin) : "专注 0"}),
        el("span", {text: fmtMoney(r.spend)}),
        el("span", {text: r.moodAvg ? MOOD_FACE[Math.round(r.moodAvg)] + " " + r.moodAvg.toFixed(1) : "心情 —"}))));
  });
  card.appendChild(sec("逐月", t));

  card.appendChild(sec("这一季", kpi([
    ["完成的事", sum.done + " 件"],
    ["专注", sum.min ? fmtMin(sum.min) : "0"],
    ["支出", fmtMoney(sum.sp)],
    ["有记录", sum.active + " 天"],
  ])));

  const best = rows.slice().sort((a, b) => b.done - a.done)[0];
  const worse = rows.slice().sort((a, b) => a.done - b.done)[0];
  const words = [];
  if(sum.done) words.push("这三个月完成了 " + sum.done + " 件事，" + (best ? Number(best.m.split("-")[1]) + " 月最勤（" + best.done + " 件）" : "") + "。");
  if(worse && best && worse.done < best.done) words.push("「" + Number(worse.m.split("-")[1]) + " 月」慢一些，慢也有慢的道理。");
  if(!sum.done) words.push("这一季还没留下数字 —— 空白也是记录的一种。");
  card.appendChild(sec("一句话", el("div", {class: "p-quote", text: words.join(" ")})));
  card.appendChild(el("div", {class: "p-foot", text: "个人工作台 · 季刊 · " + year + " Q" + q + " · 打印于 " + WB.todayStr()}));
  return card;
}

/* ---------- 纸 ⑤：年刊（多页册子：封面 + 一月一页） ----------
   2026-09-24 用户追加要求「做成真正的多页册子（按月分节、一月一页）」。
   结构 = 1 张封面（全年数字 + 十二月柱状 + 关键词）+ N 张月页（该月月历网格 + 四个数 +
   亮点 + 该月写下的一句话）。**只装进有记录的月份** —— 一册十二张空白页不是年刊，是废纸；
   封面会写明收了几个月。打印时每张纸之间 `break-after:page`（见 main.css）自动分页 */
function paperYearCover(year, stats, s){
  const card = el("div", {class: "paper paper-cover"});
  card.appendChild(el("div", {class: "p-cover-year", text: year}));
  card.appendChild(el("div", {class: "p-cover-sub", text: "这一年留下的东西"}));
  card.appendChild(sec("", kpi([
    ["完成的事", (s ? s.doneCount : 0) + " 件"],
    ["专注", s && s.pomoMin ? fmtMin(s.pomoMin) : "0"],
    ["番茄", (s ? s.pomoCount : 0) + " 个"],
    ["写下的字", s && s.words ? s.words + " 字" : "0"],
  ])));
  /* 十二个月一眼看全年：柱高按当月完成数（没数据的月份留一个点，不是 0） */
  const maxDone = Math.max(1, ...stats.map(r => r.done));
  const bars = el("div", {class: "p-yearbars"});
  stats.forEach(r => {
    const col = el("div", {class: "p-yb"});
    /* 没有完成记录的月份**不画柱子**（否则 2px 的零值柱看起来像一条下划线，
       容易被读成"这个月被标了记号"）；有柱子的月份给 3% 下限，免得一根线看不见 */
    if(r.done) col.appendChild(el("i", {style: {height: Math.max(3, Math.round(r.done / maxDone * 100)) + "%"}}));
    col.appendChild(el("b", {text: r.done ? String(r.done) : "·"}));
    col.appendChild(el("span", {text: r.m + "月"}));
    bars.appendChild(col);
  });
  card.appendChild(sec("十二个月", bars));

  const rows = [];
  if(s && s.topDay) rows.push("最勤的一天：" + s.topDay[0] + "，完成 " + s.topDay[1] + " 件");
  if(s && s.topHabit) rows.push("最坚持的习惯：「" + s.topHabit.name + "」打卡 " + s.topHabit.days + " 天");
  if(s && s.moodCount) rows.push("心情气候：" + MOOD_CN[s.topMoodIdx] + "（记了 " + s.moodCount + " 天）");
  if(s && s.journals) rows.push("日志：" + s.journals + " 篇");
  if(s && s.outSum) rows.push("支出 " + fmtMoney(s.outSum) + " · 收入 " + fmtMoney(s.inSum) +
    (s.topCat ? " · 最多的是「" + s.topCat + "」" : ""));
  if(s && s.days) rows.push("小雾团陪了你 " + s.days + " 天");
  if(rows.length) card.appendChild(sec("节点", el("div", {class: "p-list"}, ...rows.map(r => el("div", {text: r})))));
  if(s && s.keywords && s.keywords.length){
    card.appendChild(sec("关键词", el("div", {class: "p-quote", text: s.keywords.map(k => "#" + k).join("   ")})));
  }
  const withData = stats.filter(hasMonthData).length;
  card.appendChild(el("div", {class: "p-foot",
    text: "个人工作台 · 年刊 · " + year + " · 收了 " + withData + " 个月 · 打印于 " + WB.todayStr()}));
  return card;
}
function hasMonthData(r){
  return !!(r.done || r.moodDays || r.logDays || r.pomoMin || r.spend || r.habitDays);
}
function paperYearMonth(st){
  const card = el("div", {class: "paper"});
  card.appendChild(head(st.m + " 月",
    "有记录 " + st.active + " 天 · 写了 " + st.logDays + " 篇日志",
    st.moodAvg ? "心情 " + MOOD_FACE[Math.round(st.moodAvg)] + " " + st.moodAvg.toFixed(1) : ""));
  card.appendChild(sec("", monthGridEl(st.cells)));
  card.appendChild(sec("这个月", kpi([
    ["完成的事", st.done + " 件"],
    ["专注", st.pomoMin ? fmtMin(st.pomoMin) : "0"],
    ["支出", fmtMoney(st.spend)],
    ["打卡天数", st.habitDays + " 天"],
  ])));
  const best = st.days.slice().sort((a, b) => b.done - a.done)[0];
  const notes = [];
  if(best && best.done) notes.push("最勤的一天：" + dayCN(best.ds) + "，完成 " + best.done + " 件");
  if(st.moodDays) notes.push("心情记了 " + st.moodDays + " 天，多数是「" + MOOD_CN[Math.round(st.moodAvg)] + "」");
  if(notes.length) card.appendChild(sec("", ...notes.map(t => line(t))));
  /* 这个月写下的一句话：册子读起来才像一本书，而不是十二张报表 */
  const j = st.days.map(c => journalOn(c.ds)).find(x => x && (x.free || x.done || "").trim());
  if(j){
    const txt = (j.free || j.done || "").replace(/\s+/g, " ").trim();
    card.appendChild(sec("这个月写下的一句",
      el("div", {class: "p-quote", text: dayCN(j.date) + "　" + txt.slice(0, 160) + (txt.length > 160 ? "…" : "")})));
  }
  card.appendChild(el("div", {class: "p-foot", text: "个人工作台 · 年刊 · " + st.ym}));
  return card;
}
function paperYear(year){
  /* 必须收成字符串：yearReview.gather 内部按 `date.slice(0,4) === year` 比对，
     传数字进来会静默全灭（探针实测：一张空白的年刊，还看不出哪里错） */
  year = String(year || WB.bizDate().slice(0, 4));
  const s = WB.yearReview && WB.yearReview.gather ? WB.yearReview.gather(year) : null;
  const stats = [];
  for(let m = 1; m <= 12; m++) stats.push(yearMonthStat(Number(year), m));
  const pages = stats.filter(hasMonthData);
  const out = [paperYearCover(year, stats, s)];
  pages.forEach(r => out.push(paperYearMonth(r)));
  if(!pages.length && (!s || (!s.doneCount && !s.pomoCount && !s.journals))){
    out.push(el("div", {class: "paper"}, sec("", line("这一年还没有可回看的数据。", "p-dim"))));
  }
  return out;
}

/* ---------- 浮层 ---------- */
function ensureViewer(){
  if(viewer) return viewer;
  paperEl = el("div", {id: "sheet-paper"});
  const bar = el("div", {class: "sheet-bar"},
    el("span", {id: "sheet-title", class: "grow"}),
    el("button", {class: "btn sm primary", html: icon("download", 15) + "<span>打印 / 存 PDF</span>",
      onclick: () => window.print()}),
    el("button", {class: "btn sm ghost", html: icon("close", 15) + "<span>关上</span>", onclick: close}));
  viewer = el("div", {id: "sheet-viewer", hidden: true, role: "dialog", "aria-label": "纸"},
    bar, paperEl);
  viewer.addEventListener("click", e => { if(e.target === viewer) close(); });
  document.addEventListener("keydown", e => { if(e.key === "Escape" && openKind) close(); });
  document.body.appendChild(viewer);
  return viewer;
}
const KINDS = {
  day:     {title: "一页纸", build: paperDay},
  week:    {title: "周页",   build: paperWeek},
  month:   {title: "月历海报", build: paperMonth},
  quarter: {title: "季刊页", build: paperQuarter},
  year:    {title: "年刊",   build: paperYear},
};
function open(kind, arg){
  const k = KINDS[kind];
  if(!k){ WB.ui.toast("没有这种纸", "warn"); return; }
  ensureViewer();
  openKind = kind;
  paperEl.innerHTML = "";
  /* build 可以返回一张纸，也可以返回一叠（年刊=封面+月页）：统一按数组处理 */
  const built = k.build(arg);
  const list = Array.isArray(built) ? built : [built];
  if(list.length > 1){
    /* 多页时给每张纸右下角标页码 —— 打印出来散页之后还能排回去 */
    list.forEach((p, i) => {
      const foot = p.querySelector(".p-foot");
      if(foot) foot.appendChild(el("span", {class: "p-pageno", text: "第 " + (i + 1) + " / " + list.length + " 页"}));
    });
  }
  list.forEach(n => paperEl.appendChild(n));
  viewer.hidden = false;
  viewer.scrollTop = 0;
  if(WB.ui.syncScrim) WB.ui.syncScrim();     // 满屏遮罩：让侧栏摘掉 backdrop-filter（4.5）
  WB.$("#sheet-title").textContent = k.title + (list.length > 1 ? " · " + list.length + " 页" : "") +
    (kind === "day" ? " · " + (arg || WB.bizDate()) :
     kind === "week" ? " · " + (arg || WB.stats.weekStartOf(WB.bizDate())) :
     kind === "month" ? " · " + (arg || WB.monthStr(new Date())) : "");
}
function close(){
  if(!openKind || !viewer) return;
  openKind = null;
  viewer.hidden = true;
  paperEl.innerHTML = "";       // 放掉纸上的 DOM，别留一堆节点在内存里
  if(WB.ui.syncScrim) WB.ui.syncScrim();
}

/* ---------- 周提示：周一浮现一行（"时间的节拍"里周这一级的入口） ----------
   不做成晨间/收工那样的多步仪式：一句问候 + 两扇门，点过或过完周二就不再出现 */
function weekNudge(){
  if(!WB.stats) return null;
  const today = WB.bizDate();
  const day = WB.parseDate(today).getDay();
  if(day !== 1 && day !== 2) return null;                    // 只在周一、周二浮现
  const ws = WB.stats.weekStartOf(WB.addDaysStr(today, -7)); // 上周
  if(WB.store.get("weekNudge:" + ws, false)) return null;
  const rep = WB.store.get("weekReports", []).find(r => r.weekStart === ws) || WB.stats.buildWeeklyReport(ws);
  if(!rep.done && !rep.focusMin) return null;                // 上周什么都没记就不打扰
  const row = el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap", padding: "2px 4px"}},
    el("span", {class: "small", style: {color: "var(--accent)"}, text: "上周：完成 " + rep.done + " 件 · 专注 " +
      (rep.focusMin ? fmtMin(rep.focusMin) : "0") + " —— 要不要看一眼？"}),
    el("button", {class: "btn sm", text: "看周报", onclick: () => {
      WB.store.set("weekNudge:" + ws, true);
      const all = WB.store.get("weekReports", []);
      if(!all.find(r => r.weekStart === ws && r.comment)){
        WB.store.set("weekReports", all.filter(r => r.weekStart !== ws).concat([rep]));
      }
      WB.router.go("stats");
      WB.ui.toast("周报在统计页里，也可以 ⌘K 搜「周页」直接打印", null, {label: "打印周页", onClick: () => open("week", ws)});
    }}),
    el("button", {class: "btn sm ghost", text: "打印周页", onclick: () => {
      WB.store.set("weekNudge:" + ws, true); open("week", ws);
    }}),
    el("button", {class: "btn sm ghost", text: "先不用", onclick: () => {
      WB.store.set("weekNudge:" + ws, true); WB.router.render();
    }}));
  return row;
}

/* 不注册隐藏模块：纸没有路由，注册了只会让冒烟测试多出一个空转的"路由"（28 → 29） */
WB.sheets = {open, close, weekNudge, monthCells,
  day: paperDay, week: paperWeek, month: paperMonth, quarter: paperQuarter, year: paperYear};
})();

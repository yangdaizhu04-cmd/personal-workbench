/* modules/stats.js —— 统计看板：ECharts 图表 / 周报 / 徽章墙 / 人生刻度图 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;
let charts = []; // dispose 防泄漏

function disposeCharts(){ charts.forEach(c => { try{ c.dispose(); }catch(e){} }); charts = []; }

function chartCard(parent, title, ic, height){
  const div = el("div", {style: {width: "100%", height: (height || 260) + "px"}});
  const card = el("div", {class: "card"},
    el("div", {class: "card-title", html: icon(ic, 18) + "<span>" + title + "</span>"}), div);
  parent.appendChild(card);
  const inst = echarts.init(div, null, {renderer: "canvas"});
  charts.push(inst);
  return inst;
}
function axisStyle(){
  const cs = getComputedStyle(document.documentElement);
  return {
    ink: cs.getPropertyValue("--ink-2").trim(),
    ink3: cs.getPropertyValue("--ink-3").trim(),
    accent: cs.getPropertyValue("--accent").trim(),
    accent2: cs.getPropertyValue("--accent-2").trim(),
    split: cs.getPropertyValue("--card-border").trim(),
  };
}
function lastNDays(n){
  const out = [];
  const today = WB.bizDate();
  for(let i = n - 1; i >= 0; i--) out.push(WB.addDaysStr(today, -i));
  return out;
}
function baseGrid(){ return {left: 40, right: 16, top: 24, bottom: 28}; }

/* ================= 徽章 ================= */
const BADGES = [
  {id: "first-habit", name: "第一次打卡", icon: "sprout", desc: "完成第一次习惯打卡", check: () => WB.store.get("habitLogs", []).some(l => l.count > 0)},
  {id: "streak-7", name: "坚持一周", icon: "flame", desc: "任一习惯连续 7 天", check: () => WB.store.get("habits", []).some(h => !h.archived && WB.habits.streakOf(h.id) >= 7)},
  {id: "streak-30", name: "一月之约", icon: "flame", desc: "任一习惯连续 30 天", check: () => WB.store.get("habits", []).some(h => !h.archived && WB.habits.streakOf(h.id) >= 30)},
  {id: "pomo-100", name: "百番茄", icon: "timer", desc: "累计完成 100 个番茄", check: () => WB.store.get("pomoLog", []).filter(l => l.status === "done" && l.mode === "focus").length >= 100},
  {id: "notes-100", name: "百篇笔记", icon: "edit", desc: "累计 100 条笔记", check: () => WB.store.get("notes", []).length >= 100},
  {id: "journal-30", name: "日志三十夜", icon: "book", desc: "累计 30 篇日志", check: () => WB.store.get("journals", []).length >= 30},
  {id: "todo-500", name: "五百件事", icon: "check-circle", desc: "完成 500 件待办", check: () => WB.store.get("todos", []).filter(t => t.done).length >= 500},
  {id: "wish-10", name: "十星连珠", icon: "star", desc: "点亮 10 个愿望", check: () => WB.store.get("wishes", []).filter(w => w.done).length >= 10},
  {id: "early-4", name: "凌晨四点", icon: "moon", desc: "在凌晨 4-5 点间完成一次打卡（夜猫子认证）", check: () => WB.store.get("habitLogs", []).some(l => { const h = new Date(l.createdAt || 0).getHours(); return l.count > 0 && h >= 4 && h < 5; })},
];
function badgeCheck(){
  const got = WB.store.get("badges", {});
  let newly = [];
  BADGES.forEach(b => {
    if(!got[b.id]){
      let ok = false;
      try{ ok = b.check(); }catch(e){}
      if(ok){ got[b.id] = Date.now(); newly.push(b); }
    }
  });
  if(newly.length){
    WB.store.set("badges", got);
    if(liveBadgeGrid && liveBadgeGrid.isConnected) paintBadgeGrid(liveBadgeGrid);   // 墙开着就即时点亮
    newly.forEach((b, i) => setTimeout(() => {
      WB.ui.celebrate({big: newly.length === 1});
      WB.ui.toast("🏆 解锁徽章：「" + b.name + "」");
    }, i * 900));
  }
}

/* ================= 周报 ================= */
function weekStartOf(ds){
  const d = WB.parseDate(ds);
  const day = d.getDay(); // 周一为一周始
  const diff = (day === 0 ? 6 : day - 1);
  return WB.addDaysStr(ds, -diff);
}
function buildWeeklyReport(weekStart){
  const days = Array.from({length: 7}, (_, i) => WB.addDaysStr(weekStart, i));
  const todos = WB.store.get("todos", []);
  const created = days.reduce((s, d) => s + todos.filter(t => t.date === d).length, 0);
  const done = days.reduce((s, d) => s + todos.filter(t => t.date === d && t.done).length, 0);
  const focusMin = WB.store.get("pomoLog", []).filter(l => days.includes(l.date) && l.status === "done" && l.mode === "focus").reduce((s, l) => s + l.minutes, 0);
  const moods = WB.store.get("moods", []).filter(m => days.includes(m.date));
  const moodAvg = moods.length ? (moods.reduce((s, m) => s + m.level, 0) / moods.length) : 0;
  const spend = WB.store.get("ledger", []).filter(l => days.includes(l.date) && l.type === "out").reduce((s, l) => s + l.amount, 0);
  let comment;
  const rate = created ? Math.round(done / created * 100) : 0;
  if(!created && !focusMin) comment = "这周很闲？要么是效率极高，要么是还没开始记录 😄";
  else if(rate >= 80) comment = "完成率 " + rate + "%，这周执行得非常漂亮！";
  else if(rate >= 50) comment = "完成率 " + rate + "%，稳中有进，下周再推一把。";
  else comment = "完成率 " + rate + "%——也许目标排多了，下周少而精试试。";
  if(focusMin >= 600) comment += " 专注 " + Math.round(focusMin / 60) + " 小时，深度工作的证据确凿。";
  return {weekStart, created, done, focusMin, moodAvg: Math.round(moodAvg * 10) / 10, spend: Math.round(spend * 100) / 100, comment};
}

/* ================= 人生刻度 ================= */
function lifeGrid(){
  const refAge = WB.store.get("lifeRefAge", 30);
  const totalWeeks = 4000; // ≈76.7 年
  const lived = WB.clamp(refAge, 0, 76) * 52;
  const wrap = el("div");
  const info = el("div", {class: "row small muted", style: {marginBottom: "8px", flexWrap: "wrap", gap: "8px"}},
    el("span", {}, "参考年龄："),
    (() => {
      const inp = el("input", {type: "number", class: "input", value: refAge, min: 0, max: 76, style: {width: "70px", padding: "3px 8px", fontSize: "13px"}});
      inp.addEventListener("change", () => { WB.store.set("lifeRefAge", WB.clamp(parseInt(inp.value) || 0, 0, 76)); disposeCharts(); WB.router.render(); });
      return inp;
    })(),
    el("span", {class: "faint"}, "已点亮 " + lived + " / " + totalWeeks + " 周 —— 每格是一周，看完更想好好过今天"));
  wrap.appendChild(info);
  const grid = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(52, 1fr)", gap: "2.5px"}});
  for(let i = 0; i < totalWeeks; i++){
    grid.appendChild(el("div", {style: {aspectRatio: "1", borderRadius: "2px",
      background: i < lived ? "var(--accent)" : "var(--card-2)",
      opacity: i < lived ? (0.35 + 0.65 * (i / lived)) : 1,
      border: "0.5px solid var(--card-border)"}}));
  }
  wrap.appendChild(grid);
  return wrap;
}

/* ================= 模块 ================= */
WB.registerModule({
  id: "stats",
  title: "统计看板",
  icon: "chart",
  sub: () => "数据会说话",

  render(view){
    if(!WB.ui.whenLib(() => typeof echarts !== "undefined", view)) return;   // 图表库还在后台加载
    disposeCharts();
    let range = 30;

    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    const seg = el("div", {class: "seg"});
    [7, 30, 90].forEach(n => seg.appendChild(el("button", {class: n === range ? "on" : "", text: "近 " + n + " 天",
      onclick: () => { range = n; WB.router.render(); }})));
    bar.appendChild(seg);
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("gift", 14) + "<span>本周报告</span>", onclick: () => weeklyModal()}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("star", 14) + "<span>徽章墙</span>", onclick: () => badgeModal()}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("grid", 14) + "<span>人生刻度</span>", onclick: () => {
      WB.ui.modal({title: "人生刻度图 · 4000 周", icon: "grid", content: lifeGrid(), wide: true,
        actions: [{label: "关", primary: true}]});
    }}));
    view.appendChild(bar);

    const days = lastNDays(range);
    const A = axisStyle();

    /* 1. 待办完成趋势 */
    const todoData = days.map(d => WB.store.get("todos", []).filter(t => t.date === d && t.done).length);
    chartCard(view, "待办完成趋势", "trend-up").setOption({
      grid: baseGrid(),
      tooltip: {trigger: "axis"},
      xAxis: {type: "category", data: days.map(d => d.slice(5)), axisLabel: {color: A.ink3, fontSize: 10}, axisLine: {lineStyle: {color: A.split}}},
      yAxis: {type: "value", axisLabel: {color: A.ink3, fontSize: 10}, splitLine: {lineStyle: {color: A.split}}},
      series: [{type: "line", data: todoData, smooth: true, symbolSize: 5,
        lineStyle: {color: A.accent, width: 2.5}, itemStyle: {color: A.accent},
        areaStyle: {color: {type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: A.accent + "55"}, {offset: 1, color: A.accent + "05"}]}}}],
    });

    /* 2. 专注时长 */
    const pomoData = days.map(d => WB.store.get("pomoLog", []).filter(l => l.date === d && l.status === "done" && l.mode === "focus").reduce((s, l) => s + l.minutes, 0));
    chartCard(view, "专注时长（分钟）", "timer").setOption({
      grid: baseGrid(),
      tooltip: {trigger: "axis"},
      xAxis: {type: "category", data: days.map(d => d.slice(5)), axisLabel: {color: A.ink3, fontSize: 10}, axisLine: {lineStyle: {color: A.split}}},
      yAxis: {type: "value", axisLabel: {color: A.ink3, fontSize: 10}, splitLine: {lineStyle: {color: A.split}}},
      series: [{type: "bar", data: pomoData, barMaxWidth: 18, itemStyle: {borderRadius: [6, 6, 0, 0],
        color: {type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: A.accent2}, {offset: 1, color: A.accent}]}}}],
    });

    /* 2.5 晨雾指数（按时完成 +5 / 逾期 -3 / 番茄 +2，封顶 100；历史逾期状态无法复原，只对今天计扣分） */
    const karmaData = days.map(d => WB.karmaDay ? WB.karmaDay(d) : 0);
    chartCard(view, "晨雾指数", "sparkle").setOption({
      grid: baseGrid(),
      tooltip: {trigger: "axis"},
      xAxis: {type: "category", data: days.map(d => d.slice(5)), axisLabel: {color: A.ink3, fontSize: 10}, axisLine: {lineStyle: {color: A.split}}},
      yAxis: {type: "value", min: 0, max: 100, axisLabel: {color: A.ink3, fontSize: 10}, splitLine: {lineStyle: {color: A.split}}},
      series: [{type: "line", data: karmaData, smooth: true, symbolSize: 5,
        lineStyle: {color: A.accent2, width: 2.5}, itemStyle: {color: A.accent2},
        areaStyle: {color: {type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: A.accent2 + "55"}, {offset: 1, color: A.accent2 + "05"}]}}}],
    });

    /* 3. 心情曲线 */
    const moodData = days.map(d => {
      const m = WB.store.get("moods", []).find(x => x.date === d);
      return m ? m.level : null;
    });
    chartCard(view, "心情曲线（1-5）", "smile").setOption({
      grid: baseGrid(),
      tooltip: {trigger: "axis"},
      xAxis: {type: "category", data: days.map(d => d.slice(5)), axisLabel: {color: A.ink3, fontSize: 10}, axisLine: {lineStyle: {color: A.split}}},
      yAxis: {type: "value", min: 1, max: 5, axisLabel: {color: A.ink3, fontSize: 10}, splitLine: {lineStyle: {color: A.split}}},
      series: [{type: "line", data: moodData, connectNulls: true, smooth: true,
        lineStyle: {color: "#d4a76a", width: 2.5}, itemStyle: {color: "#d4a76a"}}],
    });

    /* 4. 时间去向（按绑定任务的清单归类） */
    const focusLogs = WB.store.get("pomoLog", []).filter(l => l.status === "done" && l.mode === "focus" && days.includes(l.date));
    const byList = {};
    const listDefs = WB.store.get("todoLists", []);
    focusLogs.forEach(l => {
      let key = "未绑定";
      if(l.bindType === "todo"){
        const t = WB.store.get("todos", []).find(x => x.id === l.bindId);
        const list = t && listDefs.find(x => x.id === t.listId);
        key = list ? list.name : (t ? "无清单任务" : "已删任务");
      }else if(l.bindType === "skill"){
        const sk = WB.store.get("skills", []).find(x => x.id === l.bindId);
        key = "技能 · " + (sk ? sk.name : "已删");
      }
      byList[key] = (byList[key] || 0) + l.minutes;
    });
    const pieData = Object.entries(byList).map(([name, value]) => ({name, value}));
    if(pieData.length){
      chartCard(view, "时间去向", "clock").setOption({
        tooltip: {trigger: "item", formatter: "{b}: {c} 分钟 ({d}%)"},
        series: [{type: "pie", radius: ["42%", "70%"], center: ["50%", "52%"],
          data: pieData,
          label: {color: A.ink, fontSize: 11},
          itemStyle: {borderRadius: 8, borderColor: A.split, borderWidth: 2},
          color: [A.accent, A.accent2, "#d4a76a", "#8fbf9f", "#dd9a84", "#89a7d0"]}],
      });
    }

    /* 5. 月支出汇总（近 6 月） */
    const months = Array.from({length: 6}, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i));
      return WB.monthStr(d);
    });
    const spendData = months.map(ym => WB.store.get("ledger", []).filter(l => l.type === "out" && l.date.startsWith(ym)).reduce((s, l) => s + l.amount, 0));
    if(spendData.some(v => v > 0)){
      chartCard(view, "月支出汇总", "wallet").setOption({
        grid: baseGrid(),
        tooltip: {trigger: "axis"},
        xAxis: {type: "category", data: months.map(m => m.slice(2)), axisLabel: {color: A.ink3, fontSize: 10}, axisLine: {lineStyle: {color: A.split}}},
        yAxis: {type: "value", axisLabel: {color: A.ink3, fontSize: 10}, splitLine: {lineStyle: {color: A.split}}},
        series: [{type: "bar", data: spendData, barMaxWidth: 26, itemStyle: {borderRadius: [6, 6, 0, 0], color: "#d49a6e"}}],
      });
    }

    /* 6. 技能投入分布 */
    const skillLogs = focusLogs.filter(l => l.bindType === "skill");
    if(skillLogs.length){
      const bySkill = {};
      skillLogs.forEach(l => {
        const sk = WB.store.get("skills", []).find(x => x.id === l.bindId);
        const key = sk ? sk.name : "已删技能";
        bySkill[key] = (bySkill[key] || 0) + l.minutes;
      });
      chartCard(view, "技能投入分布", "zap").setOption({
        tooltip: {trigger: "item", formatter: "{b}: {c} 分钟 ({d}%)"},
        series: [{type: "pie", radius: "62%", center: ["50%", "52%"],
          data: Object.entries(bySkill).map(([name, value]) => ({name, value})),
          label: {color: A.ink, fontSize: 11}, itemStyle: {borderRadius: 6}}],
      });
    }

    /* 7. 打卡热力图（近一年，独立卡片） */
    const heat = el("div", {class: "card", style: {marginTop: "16px"}},
      el("div", {class: "card-title", html: icon("flame", 18) + "<span>打卡热力图（近一年）</span>"}));
    const heatDiv = el("div", {style: {width: "100%", height: "170px"}});
    heat.appendChild(heatDiv);
    view.appendChild(heat);
    const heatChart = echarts.init(heatDiv);
    charts.push(heatChart);
    const year = lastNDays(364);
    const habits = WB.store.get("habits", []);
    const heatData = year.map(d => {
      const logs = WB.store.get("habitLogs", []).filter(l => l.date === d && l.count > 0);
      const ratio = habits.length ? logs.length / habits.length : 0;
      return [d, Math.round(ratio * 100)];
    });
    heatChart.setOption({
      tooltip: {formatter: p => p.value[0] + " · 完成 " + p.value[1] + "%"},
      visualMap: {show: false, min: 0, max: 100, inRange: {color: ["rgba(127,163,189,.12)", "rgba(127,163,189,.95)"]}},
      calendar: {cellSize: ["auto", 15], range: WB.bizDate().slice(0, 4),
        itemStyle: {color: "var(--card-2)", borderColor: "transparent", borderWidth: 2},
        splitLine: {show: false},
        yearLabel: {show: false},
        monthLabel: {color: A.ink3, fontSize: 10},
        dayLabel: {color: A.ink3, fontSize: 9, firstDay: 1, nameMap: ["日", "一", "二", "三", "四", "五", "六"]}},
      series: [{type: "heatmap", coordinateSystem: "calendar", data: heatData}],
    });

    /* 周报自动生成检查（每周一以后补上周日的） */
    ensureWeekly();
  },
});

/* ---------- 周报弹窗 ---------- */
function weeklyModal(){
  const ws = weekStartOf(WB.bizDate());
  let rep = WB.store.get("weekReports", []).find(r => r.weekStart === ws);
  if(!rep){ rep = buildWeeklyReport(ws); }
  const body = el("div");
  const stat = el("div", {class: "grid grid-2", style: {marginBottom: "12px", gap: "10px"}});
  const cell = (label, val) => el("div", {class: "card", style: {padding: "12px", boxShadow: "none", background: "var(--card-2)"}},
    el("div", {class: "small faint", text: label}),
    el("div", {style: {fontSize: "20px", fontWeight: "600"}, text: val}));
  stat.append(
    cell("完成 / 创建任务", rep.done + " / " + rep.created),
    cell("专注时长", Math.round(rep.focusMin / 60 * 10) / 10 + " 小时"),
    cell("平均心情", rep.moodAvg ? rep.moodAvg + " / 5" : "未记录"),
    cell("支出", "¥" + rep.spend));
  body.appendChild(stat);
  body.appendChild(el("div", {class: "card", style: {boxShadow: "none", background: "var(--accent-soft)", padding: "12px 14px", border: "none"},
    html: icon("sparkle", 15) + "<span style='font-size:14px'> " + esc(rep.comment) + "</span>"}));
  const sum = el("textarea", {class: "input", placeholder: "手写周总结：这周最得意的事 / 教训 / 下周想试的…", style: {minHeight: "90px", marginTop: "12px"}});
  sum.value = rep.summary || "";
  body.appendChild(sum);
  WB.ui.modal({title: "每周报告 · " + rep.weekStart + " 起", icon: "gift", content: body, wide: true,
    actions: [{label: "保存总结", primary: true, onClick: () => {
      rep.summary = sum.value.trim();
      const all = WB.store.get("weekReports", []).filter(r => r.weekStart !== ws);
      all.unshift(rep);
      WB.store.set("weekReports", all.slice(0, 60));
      WB.ui.toast("周报已存档");
    }}]});
}
function ensureWeekly(){
  const ws = weekStartOf(WB.bizDate());
  const all = WB.store.get("weekReports", []);
  if(!all.find(r => r.weekStart === ws && r.comment)){
    const rep = buildWeeklyReport(ws);
    const rest = all.filter(r => r.weekStart !== ws);
    WB.store.set("weekReports", rest.concat([rep]));
  }
}

/* ---------- 徽章墙 ---------- */
/* 墙开着的时候解锁新徽章（例如一边专注一边开着它），格子要立刻点亮而不是停在灰态：
   记下当前格子容器，badgeCheck 解锁后直接重绘它（踩坑 #057） */
let liveBadgeGrid = null;
function paintBadgeGrid(grid){
  grid.innerHTML = "";
  const got = WB.store.get("badges", {});
  BADGES.forEach(b => {
    const on = !!got[b.id];
    grid.appendChild(el("div", {class: "card center col", style: {padding: "18px 10px", textAlign: "center",
      background: on ? "var(--card)" : "var(--card-2)", boxShadow: on ? "var(--shadow-s)" : "none",
      opacity: on ? 1 : .55, border: on ? "1.5px solid var(--accent-soft)" : "1px dashed var(--card-border)"}},
      el("div", {style: {fontSize: "30px", filter: on ? "none" : "grayscale(1)"}, html: WB.icon(b.icon, 30)}),
      el("div", {style: {fontWeight: "600", marginTop: "6px"}, text: b.name}),
      el("div", {class: "small faint", style: {marginTop: "3px"}, text: b.desc}),
      el("div", {class: "small", style: {color: on ? "var(--accent)" : "var(--ink-3)", marginTop: "4px"},
        text: on ? "✓ " + new Date(got[b.id]).toLocaleDateString() : "未解锁"})));
  });
}
function badgeModal(){
  badgeCheck();
  const body = el("div");
  const grid = el("div", {class: "grid grid-3", style: {gap: "10px"}});
  liveBadgeGrid = grid;
  paintBadgeGrid(grid);
  body.appendChild(grid);
  let m = null;
  m = WB.ui.modal({title: "成就徽章墙", icon: "star", content: body, wide: true,
    onClose: () => { liveBadgeGrid = null; },
    actions: [{label: "关", primary: true, onClick: () => { if(m) m.close(); }}]});
}

WB.badgeCheck = badgeCheck;
WB.stats = {weekStartOf, buildWeeklyReport, ensureWeekly};
})();

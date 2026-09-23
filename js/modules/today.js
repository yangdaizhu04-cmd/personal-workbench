/* modules/today.js —— 今日总览：日期卡 / 三大件 / 可拖拽卡片流 / 收工按钮 / 防分心淡出 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

const DEFAULT_CARDS = [
  "big3", "todos", "habits", "mood", "pomodoro", "countdown",
  "goals", "journal", "rate", "word", "memory", "quote", "koi", "term", "content", "rss", "datacare",
];
const CARD_META = {
  big3:      {name: "今日三大件", icon: "target"},
  todos:     {name: "今日待办", icon: "check-circle"},
  habits:    {name: "打卡进度", icon: "flame"},
  mood:      {name: "心情速记", icon: "smile"},
  pomodoro:  {name: "番茄钟", icon: "timer"},
  countdown: {name: "最近的倒数日", icon: "hourglass"},
  goals:     {name: "月度目标", icon: "trend-up"},
  journal:   {name: "今日日志", icon: "book"},
  rate:      {name: "汇率速览", icon: "wallet"},
  word:      {name: "每日单词", icon: "book-open"},
  memory:    {name: "每日旧忆", icon: "feather"},
  quote:     {name: "每日一句", icon: "quote"},
  koi:       {name: "锦鲤引言", icon: "droplet"},
  term:      {name: "节气 · 月相", icon: "moon-star"},
  content:   {name: "今日看点", icon: "sparkle"},
  rss:       {name: "RSS 订阅", icon: "rss"},
  datacare:  {name: "数据健康", icon: "shield"},
};

/* ---------- 今日页的番茄卡：秒级局部跟随 ----------
   pomo:tick 每秒来一次，只改这两个文本节点（整页重建太贵）；
   状态切换（暂停/继续/完成/放弃）由 pomodoro.js 广播 view:dirty 走整页重绘，两条路各管各的 */
let pomoLive = null;
function fmtPomo(sec){
  sec = Math.max(0, Math.round(sec));
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}
function pomoTag(st){
  if(st.needConfirm) return st.mode === "focus" ? "专注完成 · 去确认" : "休息结束 · 去确认";
  if(!st.running) return "已暂停 · 点开继续";
  return st.mode === "focus" ? "专注中 · 保持住" : "休息一下";
}
WB.bus.on("pomo:tick", t => {
  if(!pomoLive || !pomoLive.num.isConnected) return;
  pomoLive.num.textContent = fmtPomo(t.remainSec);
  pomoLive.tag.textContent = pomoTag({mode: t.mode, running: t.running, needConfirm: false});
});

function cardPrefs(){
  const saved = WB.store.get("uiPrefs", {}).todayCards;
  if(!saved) return DEFAULT_CARDS.map(id => ({id, hidden: false}));
  // 补充新增卡片
  const out = saved.slice();
  DEFAULT_CARDS.forEach(id => { if(!out.some(c => c.id === id)) out.push({id, hidden: false}); });
  return out;
}
function saveCardPrefs(prefs){
  const p = WB.store.get("uiPrefs", {});
  p.todayCards = prefs;
  WB.store.set("uiPrefs", p);
}
/* 常驻三张：仪式 → 执行 → 复盘，首屏一眼看完（其余卡片收在折叠条里） */
const PINNED = ["big3", "todos", "journal"];
/* 折叠状态：
   - 全新档案（没有 todayCards）→ 默认收起，首屏只有三张卡
   - 已经布局过的老档案（有 todayCards 但没这个键）→ 默认展开，不会被突然收走
   - 用户手动点过折叠条 → 以记下的值为准 */
function cardsExpanded(){
  const ui = WB.store.get("uiPrefs", {});
  if(typeof ui.todayExpanded === "boolean") return ui.todayExpanded;
  return !!ui.todayCards;
}
function setCardsExpanded(v){
  const ui = WB.store.get("uiPrefs", {});
  ui.todayExpanded = !!v;
  WB.store.set("uiPrefs", ui);
}
/* 极简模式：一键只留顶部日期天气 + 今日三大件（比折叠条更彻底的专注时刻） */
function minimalOn(){
  const ui = WB.store.get("uiPrefs", {});
  return !!ui.todayMinimal;
}
function setMinimal(v){
  const ui = WB.store.get("uiPrefs", {});
  ui.todayMinimal = !!v;
  WB.store.set("uiPrefs", ui);
}
/* 防分心：番茄专注中或收工后，内容类卡片淡出 */
function contentHidden(){
  return (WB.pomodoro && WB.pomodoro.isFocusing && WB.pomodoro.isFocusing()) ||
         (WB.store.get("offworkDone:" + WB.bizDate(), false));
}

/* ---------- 一键动作 / 数据健康 ---------- */
/* 一键开始番茄：默认档时长、不绑对象；已在计时/待确认时不打扰，只带路 */
function quickPomodoro(){
  if(!WB.pomodoro || !WB.pomodoro.begin){ WB.router.go("pomodoro"); return; }
  const st = WB.pomodoro.state();
  if(st && (st.running || st.needConfirm)){ WB.router.go("pomodoro"); return; }
  const min = WB.theme.get("pomodoroFocus") || 25;
  WB.router.go("pomodoro");
  WB.pomodoro.begin("focus", min);
  WB.ui.toast("已开始 " + min + " 分钟专注，加油 ✦");
}
/* 一键备份：与设置页「导出 JSON」同一套数据与文件名口径 */
function quickBackup(){
  const data = WB.store.exportAll();
  data.__meta = {app: "个人工作台", version: 1, exportedAt: new Date().toISOString()};
  WB.downloadFile("个人工作台备份-" + WB.todayStr() + ".json", JSON.stringify(data, null, 2), "application/json");
  WB.theme.set("lastExportTs", Date.now());
  WB.ui.toast("备份已导出到下载");
}
/* localStorage 里 wb: 前缀的占用估算（字符数 ≈ UTF-16 字节数，取整 KB 足够） */
function storageBytes(){
  let n = 0;
  try{
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(k && k.indexOf("wb:") === 0) n += k.length + (localStorage.getItem(k) || "").length;
    }
  }catch(e){}
  return n;
}
function fmtBytes(n){
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
function daysAgoCN(ts){
  if(!ts) return "";
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? "今天" : d + " 天前";
}

/* ---------- 今日纪念卡：三大件全完成时生成一张可保存的 PNG（每天最多弹一次） ---------- */
function showMemoryCard(dateStr, items){
  if(WB.store.get("memoryCard:" + dateStr, false)) return;
  WB.store.set("memoryCard:" + dateStr, true);
  setTimeout(() => {   // 让彩带先飞一会儿再上弹窗
    const W = 720, H = 900;
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
    blob(130, 150, 280, "rgba(127,163,189,.28)");
    blob(620, 260, 250, "rgba(176,160,209,.24)");
    blob(560, 780, 320, "rgba(238,196,168,.2)");
    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    rr(60, 90, 600, 640, 28);
    ctx.fillStyle = "rgba(255,253,247,.85)";
    ctx.fill();
    const d = WB.parseDate(dateStr);
    ctx.textAlign = "center";
    ctx.fillStyle = "#4a4a5a";
    ctx.font = "600 46px " + FONT;
    ctx.fillText((d.getMonth() + 1) + " 月 " + d.getDate() + " 日", W / 2, 210);
    ctx.fillStyle = "#8a8a9a";
    ctx.font = "24px " + FONT;
    ctx.fillText(WB.WEEK_CN[d.getDay()] + " · 今日三大件全部完成", W / 2, 258);
    ctx.strokeStyle = "rgba(127,163,189,.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(140, 292); ctx.lineTo(580, 292); ctx.stroke();
    ctx.textAlign = "left";
    items.forEach((it, i) => {
      const y = 366 + i * 96;
      ctx.strokeStyle = "#7fa3bd"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(150, y - 12, 17, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(141, y - 12); ctx.lineTo(148, y - 4); ctx.lineTo(161, y - 22);
      ctx.stroke();
      ctx.fillStyle = "#4a4a5a";
      ctx.font = "30px " + FONT;
      ctx.fillText(it.title.length > 14 ? it.title.slice(0, 14) + "…" : it.title, 190, y);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "#7fa3bd";
    ctx.font = "600 34px " + FONT;
    ctx.fillText("把今天好好过完了 ✦", W / 2, 672);
    ctx.fillStyle = "#b0a8b8";
    ctx.font = "20px " + FONT;
    ctx.fillText("晨雾奶油 · 个人工作台", W / 2, 838);
    cv.style.cssText = "width:100%;max-width:330px;border-radius:16px;box-shadow:0 12px 32px rgba(80,80,120,.14);margin:0 auto;display:block;";
    WB.ui.modal({title: "今日纪念卡片", icon: "sparkle", content: cv,
      actions: [
        {label: "保存图片", primary: true, onClick: () => {
          cv.toBlob(b => WB.downloadFile("今日纪念卡-" + dateStr + ".png", b, "image/png"));
          WB.ui.toast("已保存到下载");
          return true;   // 返回真值 → modal 自动关
        }},
        {label: "关闭"}]});
  }, 800);
}

WB.registerModule({
  id: "today",
  title: "今日",
  icon: "home",
  sub: function(){ const d = WB.bizDate(); return WB.fmtDateCN(d, true) + (WB.cal.festivalOf(d) ? " · " + WB.cal.festivalOf(d) : ""); },

  render(view){
    const dateStr = WB.bizDate();
    const wrap = el("div", {class: "col", style: {gap: "16px"}});

    /* ===== 顶部：日期 + 班休 + 天气 ===== */
    wrap.appendChild(this.dateCard(dateStr));

    /* ===== 一键动作：高频操作不跳页（极简模式下不显示，尊重「只留三大件」） ===== */
    const minimal = minimalOn();
    if(!minimal){
      wrap.appendChild(el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap"}},
        el("button", {class: "btn sm ghost", html: icon("timer", 14) + "<span>开始番茄</span>",
          onclick: quickPomodoro}),
        el("button", {class: "btn sm ghost", html: icon("book", 14) + "<span>写日志</span>",
          onclick: () => { if(WB.journal && WB.journal.editor) WB.journal.editor(dateStr); }}),
        el("button", {class: "btn sm ghost", html: icon("wallet", 14) + "<span>记一笔</span>",
          onclick: () => { if(WB.ledger && WB.ledger.quickAdd) WB.ledger.quickAdd(); }}),
        el("button", {class: "btn sm ghost", html: icon("download", 14) + "<span>备份数据</span>",
          onclick: quickBackup})));
    }

    /* ===== 窗景入口（ThreeUI 场景页；单文件版自动隐藏） ===== */
    if(!minimal && WB.scenes && !window.WB_SINGLE_FILE){
      wrap.appendChild(el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap"}},
        el("span", {class: "small faint", style: {alignSelf: "center"}, text: "窗外："}),
        Object.entries(WB.scenes.SCENES).map(([key, s]) =>
          el("button", {class: "btn sm ghost", text: s.title.replace("窗外 · ", ""),
            onclick: () => WB.scenes.open(key)}))));
    }

    /* ===== 今日三大件（仪式圈选，置顶展示） ===== */
    /* ===== 卡片流（可拖拽排序/显隐） ===== */
    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    const prefs = cardPrefs();
    const builders = {
      big3: () => this.big3Card(dateStr),
      todos: () => this.todosCard(dateStr),
      habits: () => this.habitsCard(dateStr),
      mood: () => this.moodCard(dateStr),
      pomodoro: () => this.pomodoroCard(),
      countdown: () => this.countdownCard(dateStr),
      goals: () => this.goalsCard(),
      journal: () => this.journalCard(dateStr),
      rate: () => this.rateCard(),
      word: () => this.wordCard(dateStr),
      memory: () => this.memoryCard(dateStr),
      quote: () => this.quoteCard(dateStr),
      koi: () => this.koiCard(dateStr),
      term: () => this.termCard(dateStr),
      content: () => this.contentCard(dateStr),
      rss: () => this.rssCard(),
      datacare: () => this.datacareCard(),
    };
    const nodes = [];
    const expanded = cardsExpanded();
    prefs.forEach(p => {
      if(p.hidden) return;
      if(minimal && p.id !== "big3") return;            // 极简：只留三大件
      if(!PINNED.includes(p.id) && !expanded) return;   // 折叠态只渲染常驻三张
      if(p.id === "content" && contentHidden()) return;
      const b = builders[p.id];
      if(!b) return;
      let card;
      try{ card = b(); }catch(e){ console.error("[today]", p.id, e); return; }
      if(!card) return;
      card.dataset.dragId = p.id;
      card.classList.add("hoverable");
      WB.enableDrag(card);
      nodes.push(card);
    });
    nodes.forEach(n => grid.appendChild(n));
    if(minimal) grid.style.gridTemplateColumns = "1fr";   // 只剩一张卡时占满整行
    if(!nodes.length){
      grid.appendChild(el("div", {class: "card"},
        WB.ui.emptyState("sparkle", "今天从一张白纸开始", "右侧 ⚙ 可以在设置里打开卡片，或去仪式里圈出今日重点。")));
    }
    WB.ui.draggable(grid, {itemSel: ".card", onReorder: ids => {
      const order = new Map(ids.map((id, i) => [id, i]));
      const next = cardPrefs().slice().sort((a, b) =>
        (order.has(a.id) ? order.get(a.id) : 99) - (order.has(b.id) ? order.get(b.id) : 99));
      saveCardPrefs(next);
      WB.ui.toast("卡片顺序已记住");
    }});

    /* 卡片管理条（极简模式下连管理条也收掉） */
    if(!minimal){
      const manageBar = el("div", {class: "row", style: {justifyContent: "flex-end", padding: "2px 4px"}});
      manageBar.appendChild(el("button", {class: "btn sm ghost", html: icon("grid", 14) + "<span>卡片管理</span>",
        onclick: () => this.cardManager()}));
      wrap.appendChild(manageBar);
    }
    wrap.appendChild(grid);

    /* 折叠条 + 极简开关：常驻三张之外的卡片收在这里。
       以前 15 张卡默认全铺，首屏要滚 2.6 屏；现在新档案一眼看完，点一下全展开 */
    const extra = prefs.filter(p => !p.hidden && !PINNED.includes(p.id) && builders[p.id]);
    const bar = el("div", {class: "center col", style: {gap: "4px"}});
    bar.appendChild(el("button", {class: "btn sm ghost",
      text: minimal ? "退出极简模式" : "极简模式 · 只留三大件",
      onclick: () => { setMinimal(!minimal); WB.router.render(); }}));
    if(!minimal && extra.length){
      const names = extra.slice(0, 4).map(p => (CARD_META[p.id] || {}).name).filter(Boolean).join(" · ");
      bar.appendChild(el("button", {class: "btn sm ghost",
        text: expanded ? "收起卡片（只留三大件 / 待办 / 日志）" : "展开其余 " + extra.length + " 张卡片",
        onclick: () => { setCardsExpanded(!expanded); WB.router.render(); }}));
      if(!expanded) bar.appendChild(el("span", {class: "small faint", text: names + (extra.length > 4 ? " 等" : "")}));
    }
    wrap.appendChild(bar);

    /* ===== 收工按钮（18 点后 / 手动） ===== */
    const hour = new Date().getHours();
    const offworkDone = WB.store.get("offworkDone:" + dateStr, false);
    if(hour >= WB.theme.get("offworkHour") && !offworkDone){
      const btn = el("button", {class: "btn primary", style: {margin: "6px auto", display: "flex"},
        html: icon("moon", 16) + "<span>今天到这里，收工 ✦</span>",
        onclick: () => WB.rituals && WB.rituals.startOffwork()});
      wrap.appendChild(btn);
    }

    view.appendChild(wrap);
  },

  /* ---------- 日期卡 ---------- */
  dateCard(dateStr){
    const d = WB.parseDate(dateStr);
    const week = WB.WEEK_CN[d.getDay()];
    const hol = WB.cal.holidayOf(dateStr);
    const fest = WB.cal.festivalOf(dateStr);
    const lunar = WB.cal.lunarOf(dateStr);

    const right = el("div", {class: "grow", id: "weather-mini",
      style: {textAlign: "right", fontSize: "13px", color: "var(--ink-2)"}});
    /* 骨架条代替"加载中…"：慢网下也有形状，数据到了 renderMini 会清空重填 */
    right.appendChild(el("div", {class: "row", style: {justifyContent: "flex-end", gap: "8px"}},
      WB.ui.skLine("22px", "22px", "50%"), WB.ui.skLine("96px", "14px")));
    if(WB.weather && WB.weather.renderMini) WB.weather.renderMini(right);

    return el("div", {class: "card hoverable"},
      el("div", {class: "row", style: {alignItems: "flex-start"}},
        el("div", {},
          el("div", {style: {fontSize: "26px", fontWeight: "600", lineHeight: 1.3}},
            (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 ",
            el("span", {class: "muted", style: {fontSize: "15px"}, text: week}),
            hol ? el("span", {class: "chip", style: {marginLeft: "8px"},
              text: hol.type === "休" ? hol.name + " · 休" : "调休上班"}) : null),
          el("div", {class: "small muted", style: {marginTop: "4px"}},
            lunar ? "农历 " + lunar.monthCn + lunar.dayCn + " · " + lunar.animal + "年" : "",
            fest ? " · " + fest : ""),
          /* 晨雾币 + 晨雾指数：常驻一眼可见，点击进设置里的奖励商店 */
          el("div", {class: "small", style: {marginTop: "4px", color: "var(--accent)", cursor: "pointer"},
            onclick: () => WB.router.go("settings"),
            text: "✦ " + (WB.coins ? WB.coins.balance() : 0) + " 币 · 晨雾指数 " + (WB.karmaDay ? WB.karmaDay(dateStr) : 0)})),
        right));
  },

  /* ---------- 今日三大件 ---------- */
  big3Card(dateStr){
    const items = WB.store.get("bigThree:" + dateStr, []);
    const list = el("div", {class: "list"});
    const save = () => WB.store.set("bigThree:" + dateStr, items);
    if(!items.length){
      return el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("target", 18) + "<span>今日三大件</span><span class='card-sub'>晨间仪式圈选</span>"}),
        el("div", {class: "small faint", style: {padding: "2px 0 12px"}, text: "最多 3 件。聚焦的事少了，完成的事才会多。"}),
        el("div", {class: "center col", style: {gap: "8px"}},
          el("button", {class: "btn sm primary", text: "+ 圈出今日重点",
            onclick: () => WB.rituals && WB.rituals.pickBigThree(dateStr)}),
          el("button", {class: "btn sm ghost", html: icon("sun", 14) + "<span>走一遍晨间仪式</span>",
            onclick: () => WB.rituals && WB.rituals.startMorning()})));
    }
    items.forEach((it, i) => {
      list.appendChild(el("div", {class: "list-row"},
        el("button", {html: icon(it.done ? "check-circle" : "circle", 20),
          style: {color: it.done ? "var(--ok)" : "var(--ink-3)", display: "flex", transition: "transform .2s"},
          onclick: e => {
            it.done = !it.done; save();
            if(it.done){
              WB.ui.starBurst(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
              WB.ui.chime("done");
              if(items.every(x => x.done)){
                WB.ui.celebrate({big: true}); WB.ui.toast("今日三大件全部完成，了不起 ✦");
                if(WB.coins) WB.coins.big3Bonus();
                showMemoryCard(dateStr, items);
              }
              }
              WB.router.render();
              if(WB.badgeCheck) WB.badgeCheck();   // 三大件结算点：以前漏了
          }}),
        el("span", {class: "grow" + (it.done ? " faint" : ""),
          style: it.done ? {textDecoration: "line-through"} : {}, text: it.title}),
        el("button", {class: "icon-btn", html: icon("close", 14), onclick: () => {
          items.splice(i, 1); save(); WB.router.render();
        }})));
    });
    return el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("target", 18) + "<span>今日三大件</span>",
        onclick: () => WB.rituals && WB.rituals.pickBigThree(dateStr)}),
      list);
  },

  /* ---------- 今日待办 ---------- */
  todosCard(dateStr){
    const todos = WB.store.get("todos", []).filter(t => t.date === dateStr && !t.done);
    const overdue = WB.store.get("todos", []).filter(t => !t.done && t.date && t.date < dateStr && !(t.repeat && t.repeat.type !== "none"));
    const box = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("check-circle", 18) + "<span>今日待办</span><span class='card-sub'>"
        + todos.length + " 件待完成" + (overdue.length ? " · 逾期 " + overdue.length : "") + "</span>",
        onclick: () => WB.router.go("todos")}));
    if(overdue.length){
      box.appendChild(el("div", {class: "row small", style: {color: "var(--danger)", marginBottom: "8px"},
        html: icon("bell", 14) + "<span>有 " + overdue.length + " 件过期未完成，点击去处理</span>",
        style: "cursor:pointer", onclick: () => WB.router.go("todos")}));
    }
    if(!todos.length){
      box.appendChild(WB.ui.emptyState("check", "今天还没有安排", "按 T 新建，或点下面的「添加待办」"));
    }else{
      const list = el("div", {class: "list"});
      todos.slice(0, 6).forEach(t => {
        list.appendChild(el("div", {class: "list-row"},
          el("span", {class: "prio-dot prio-" + t.prio}),
          el("span", {class: "grow ellipsis", text: t.title,
            onclick: () => WB.router.go("todos"), style: {cursor: "pointer"}}),
          t.time ? el("span", {class: "small faint nowrap", text: t.time}) : null,
          t.listId ? (() => {
            const l = WB.store.get("todoLists", []).find(x => x.id === t.listId);
            return l ? el("span", {class: "small", style: {color: l.color}, text: l.name}) : null;
          })() : null));
      });
      if(todos.length > 6) list.appendChild(el("div", {class: "small faint", style: {padding: "8px 6px"}, text: "…还有 " + (todos.length - 6) + " 件"}));
      box.appendChild(list);
    }
    box.appendChild(el("div", {class: "row", style: {marginTop: "10px"}},
      el("button", {class: "btn sm primary", html: icon("plus", 14) + "<span>添加待办</span>",
        onclick: () => WB.todos && WB.todos.quickAdd()})));
    return box;
  },

  /* ---------- 打卡进度 ---------- */
  habitsCard(dateStr){
    const habits = WB.store.get("habits", []).filter(h => !h.archived);
    const logs = WB.store.get("habitLogs", []).filter(l => l.date === dateStr);
    const box = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("flame", 18) + "<span>打卡进度</span>",
        onclick: () => WB.router.go("habits")}));
    if(!habits.length){
      box.appendChild(WB.ui.emptyState("sprout", "还没有习惯", "从小到不可能失败的习惯开始"));
      return box;
    }
    const doneCount = habits.filter(h => {
      const log = logs.find(l => l.habitId === h.id);
      return log && (h.type === "count" ? log.count >= (h.target || 1) : log.count > 0);
    }).length;
    const pct = Math.round(doneCount / habits.length * 100);
    const row = el("div", {class: "row", style: {gap: "18px", alignItems: "center"}});
    row.appendChild(WB.ui.ring(pct, 74, 6, doneCount + "/" + habits.length));
    const mini = el("div", {class: "grow col", style: {gap: "8px"}});
    habits.slice(0, 4).forEach(h => {
      const log = logs.find(l => l.habitId === h.id);
      const done = log && (h.type === "count" ? log.count >= (h.target || 1) : log.count > 0);
      mini.appendChild(el("div", {class: "row", style: {gap: "8px"}},
        el("button", {html: icon(done ? "check-circle" : "circle", 18),
          style: {color: done ? "var(--ok)" : "var(--ink-3)", display: "flex"},
          onclick: e => {
            if(WB.habits && WB.habits.quickCheck) WB.habits.quickCheck(h, e);
            else WB.router.go("habits");
          }}),
        el("span", {class: "grow small ellipsis", text: h.name}),
        h.type === "count" ? el("span", {class: "small faint", text: (log ? log.count : 0) + "/" + (h.target || 1)}) : null));
    });
    row.appendChild(mini);
    box.appendChild(row);
    return box;
  },

  /* ---------- 心情速记 ---------- */
  moodCard(dateStr){
    const allMoods = WB.store.get("moods", []);
    const rec = allMoods.find(m => m.date === dateStr);
    const faces = [["😞", "很糟"], ["🙁", "不太好"], ["😐", "一般"], ["🙂", "不错"], ["😄", "很好"]];
    const row = el("div", {class: "row", style: {justifyContent: "space-between", fontSize: "24px"}});
    faces.forEach(([emoji, label], i) => {
      const level = i + 1;
      const btn = el("button", {
        text: emoji,
        style: {fontSize: rec && rec.level === level ? "34px" : "26px", transition: "all .25s",
          filter: rec && rec.level === level ? "none" : "grayscale(.75)", opacity: rec && rec.level === level ? 1 : .6,
          transform: rec && rec.level === level ? "scale(1.12)" : "none"},
        onclick: e => {
          if(WB.mood && WB.mood.setMood){ WB.mood.setMood(dateStr, level, rec && rec.note); }
          else{
            const all = WB.store.get("moods", []);
            const ex = all.find(m => m.date === dateStr);
            if(ex) WB.store.set("moods", all.map(m => m.date === dateStr ? Object.assign(m, {level, updatedAt: Date.now()}) : m));
            else WB.store.set("moods", all.concat({id: WB.uid(), date: dateStr, level, createdAt: Date.now()}));
            WB.ui.toast("心情记下了：" + label);
          }
          WB.router.render();
        }});
      row.appendChild(btn);
    });
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("smile", 18) + "<span>心情速记</span><span class='card-sub'>点一下就好</span>",
        onclick: () => WB.router.go("mood")}),
      row);
    /* 近 7 天情绪小条：一眼看到这周的起伏（都是"·"= 没记过就不占行） */
    const MOOD_FACES = ["😞", "🙁", "😐", "🙂", "😄"];
    const wk = [];
    for(let i = 6; i >= 0; i--){
      const ds = WB.dateStr(new Date(WB.parseDate(dateStr).getTime() - i * 86400000));
      const m = allMoods.find(x => x.date === ds);
      wk.push(m ? MOOD_FACES[(m.level || 3) - 1] : "·");
    }
    if(wk.some(c => c !== "·")){
      card.appendChild(el("div", {class: "small faint", style: {marginTop: "10px", letterSpacing: "2px"},
        text: "近 7 天 " + wk.join(" ")}));
    }
    if(rec && rec.note) card.appendChild(el("div", {class: "small muted", style: {marginTop: "8px"}, text: "「" + rec.note + "」"}));
    return card;
  },

  /* ---------- 番茄钟快捷 ---------- */
  pomodoroCard(){
    const st = WB.pomodoro && WB.pomodoro.state ? WB.pomodoro.state() : null;
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("timer", 18) + "<span>番茄专注</span>",
        onclick: () => WB.router.go("pomodoro")}));
    if(st){
      /* 有会话就显示会话（含暂停与待确认）——以前只认 running，
         一暂停整张卡就退化成「开始专注」按钮，等于这段番茄不存在 */
      const num = el("div", {style: {fontSize: "34px", fontWeight: "600", fontVariantNumeric: "tabular-nums"},
        text: fmtPomo(st.remainSec)});
      const tag = el("div", {class: "small muted", text: pomoTag(st)});
      card.appendChild(el("div", {class: "center col", style: {padding: "8px 0"}}, num, tag));
      pomoLive = {num, tag};
    }else{
      pomoLive = null;
      const today = WB.bizDate();
      const done = WB.store.get("pomoLog", []).filter(l => l.date === today && l.mode === "focus" && l.status === "done").length;
      card.appendChild(el("div", {class: "center col", style: {padding: "6px 0"}},
        el("div", {style: {fontSize: "30px", fontWeight: "600"}}, done,
          el("span", {class: "small muted", text: " 个番茄"})),
        el("button", {class: "btn primary sm", style: {marginTop: "10px"}, text: "▶ 开始专注",
          onclick: () => WB.router.go("pomodoro")})));
    }
    return card;
  },

  /* ---------- 最近的倒数日 ---------- */
  countdownCard(dateStr){
    const items = WB.store.get("countdowns", []);
    const box = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("hourglass", 18) + "<span>最近的倒数日</span>",
        onclick: () => WB.router.go("countdown")}));
    const next = items.map(c => {
      let target = c.date;
      if(c.lunar && c.repeatYearly){
        target = WB.cal.nextLunarBirthday(c.lunar.lMonth, c.lunar.lDay) || c.date;
      }else if(c.repeatYearly){
        const y = new Date().getFullYear();
        let t = y + c.date.slice(4);
        if(t < dateStr) t = (y + 1) + c.date.slice(4);
        target = t;
      }
      return Object.assign({}, c, {target, diff: WB.daysBetween(dateStr, target)});
    }).sort((a, b) => a.diff - b.diff);
    const hol = WB.cal.nextHoliday();
    if(hol && hol.remain >= 0){
      box.appendChild(el("div", {class: "row", style: {padding: "6px 0"}},
        el("span", {class: "chip"}, "假期"),
        el("span", {class: "grow small", text: hol.name}),
        el("b", {text: hol.remain === 0 ? "就是今天！" : "还有 " + hol.remain + " 天"})));
    }
    if(!next.length && !hol){
      box.appendChild(WB.ui.emptyState("hourglass", "没有倒数日", "生日、纪念日、出发日都值得期待"));
      return box;
    }
    next.slice(0, 3).forEach(c => {
      const past = c.diff < 0;
      box.appendChild(el("div", {class: "row", style: {padding: "6px 0"}},
        el("span", {class: "chip plain"}, c.isBirthday ? "🎂 生日" : "纪念日"),
        el("span", {class: "grow small ellipsis", text: c.name}),
        el("b", {class: past ? "faint" : "", text: past ? "已 " + Math.abs(c.diff) + " 天" : c.diff === 0 ? "就是今天！" : "还有 " + c.diff + " 天"})));
    });
    return box;
  },

  /* ---------- 月度目标 ---------- */
  goalsCard(){
    const month = WB.monthStr(new Date());
    const goals = WB.store.get("goals", []).filter(g => g.month === month);
    const box = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("trend-up", 18) + "<span>月度目标</span>",
        onclick: () => WB.router.go("goals")}));
    if(!goals.length){
      box.appendChild(WB.ui.emptyState("target", "这个月还没立目标", "3~5 个，完成了月初归档重来"));
      return box;
    }
    goals.slice(0, 4).forEach(g => {
      box.appendChild(el("div", {style: {marginBottom: "10px"}},
        el("div", {class: "row small", style: {marginBottom: "4px"}},
          el("span", {class: "grow ellipsis", text: g.title}),
          el("b", {text: (g.progress || 0) + "%"})),
        el("div", {class: "bar"}, el("i", {style: {width: (g.progress || 0) + "%"}}))));
    });
    return box;
  },

  /* ---------- 今日日志入口 ---------- */
  journalCard(dateStr){
    const j = WB.store.get("journals", []).find(x => x.date === dateStr);
    const todos = WB.store.get("todos", []);
    const pomo = WB.store.get("pomoLog", []).filter(l => l.date === dateStr && l.status === "done").length;
    const spend = WB.store.get("ledger", []).filter(l => l.date === dateStr && l.type === "out")
      .reduce((s, l) => s + (l.amount || 0), 0);
    const card = el("div", {class: "card", style: {cursor: "pointer"},
      onclick: () => WB.router.go("journal")},
      el("div", {class: "card-title", html: icon("book", 18) + "<span>今日日志</span><span class='card-sub'>自动摘要</span>"}),
      el("div", {class: "row", style: {flexWrap: "wrap", gap: "8px"}},
        el("span", {class: "chip plain"}, "完成 " + todos.filter(t => t.date === dateStr && t.done).length + " 项任务"),
        el("span", {class: "chip plain"}, "专注 " + pomo + " 个番茄"),
        el("span", {class: "chip plain"}, "支出 ¥" + spend.toFixed(2).replace(/\.00$/, ""))));
    if(j && (j.free || j.done || j.answer)){
      card.appendChild(el("div", {class: "small muted ellipsis", style: {marginTop: "8px"},
        text: "✍ " + (j.free || j.done || "已写日志").replace(/[#*`>\-\[\]]/g, "").slice(0, 40)}));
    }else{
      card.appendChild(el("div", {class: "small faint", style: {marginTop: "8px"}, text: "今晚写几句，明天的你会感谢现在"}));
    }
    return card;
  },

  /* ---------- 汇率速览 ---------- */
  rateCard(){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("wallet", 18) + "<span>汇率速览</span>"}));
    const body = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px"}});
    card.appendChild(body);
    // 先用骨架条占位（慢网时卡片不至于空着），paint 会整体清空重填
    if(WB.rates && WB.rates.get){
      [0, 1, 2].forEach(() => body.appendChild(WB.ui.skLine("62px", "26px", "999px")));
    }
    const paint = (data, cached) => {
      body.innerHTML = "";
      const list = WB.theme.get("currencies") || ["USD", "EUR", "JPY", "HKD"];
      list.forEach(c => {
        const r = data && data.rates && data.rates[c];
        if(!r) return;
        // er-api 以 CNY 为基准时 rates[c] = 1 CNY 兑 c 的数量 → 1 c ≈ 1/rates[c] CNY
        const cny = (1 / r);
        body.appendChild(el("span", {class: "chip plain"},
          el("b", {text: c}), el("span", {class: "small muted", text: " ≈¥" + cny.toFixed(2)})));
      });
      if(cached) body.appendChild(el("span", {class: "small faint", text: "（缓存）"}));
      if(!body.children.length) body.appendChild(el("span", {class: "small faint", text: "联网后显示实时汇率，断网自动隐藏"}));
    };
    if(WB.rates && WB.rates.get) WB.rates.get().then(d => paint(d && d.data, d && d.cached));
    else body.appendChild(el("span", {class: "small faint", text: "联网后显示实时汇率，断网自动隐藏"}));
    return card;
  },

  /* ---------- 每日单词 ---------- */
  wordCard(dateStr){
    const w = WB.data.wordOf(dateStr);
    return el("div", {class: "card hoverable", style: {cursor: "pointer"},
      onclick: () => WB.copyText(w.w + " " + w.ph + "\n" + w.mean + "\n" + w.ex).then(() => WB.ui.toast("单词已复制"))},
      el("div", {class: "card-title", html: icon("book-open", 18) + "<span>每日单词</span>"}),
      el("div", {style: {fontSize: "22px", fontWeight: "600"}}, w.w),
      el("div", {class: "small muted", style: {marginTop: "2px"}}, "/" + w.ph + "/  " + w.pos),
      el("div", {style: {marginTop: "6px"}}, w.mean),
      el("div", {class: "small faint", style: {marginTop: "6px", fontStyle: "italic"}}, w.ex));
  },

  /* ---------- 每日旧忆 ---------- */
  memoryCard(dateStr){
    const today = WB.parseDate(dateStr);
    const pool = [];
    const md = dateStr.slice(5); // MM-DD
    WB.store.get("journals", []).forEach(j => {
      if(j.date.slice(5) === md && j.date !== dateStr){
        const years = today.getFullYear() - WB.parseDate(j.date).getFullYear();
        if(years >= 1) pool.push({years, text: j.free || j.done || "", from: "日志", date: j.date});
      }
    });
    WB.store.get("notes", []).forEach(n => {
      if(n.createdAt){
        const d = new Date(n.createdAt);
        const ds = WB.dateStr(d);
        if(ds.slice(5) === md && ds !== dateStr){
          const years = today.getFullYear() - d.getFullYear();
          if(years >= 1) pool.push({years, text: n.content, from: "笔记", date: ds});
        }
      }
    });
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("feather", 18) + "<span>每日旧忆</span><span class='card-sub'>过去的你写过</span>"}));
    if(!pool.length){
      card.appendChild(el("div", {class: "small faint", style: {padding: "10px 0"},
        text: "坚持记录，明年今天会收到一封来自过去的信 ✉"}));
      return card;
    }
    WB.shuffle(pool).slice(0, 3).forEach(m => {
      card.appendChild(el("div", {style: {padding: "8px 0", borderBottom: "1px dashed var(--card-border)", cursor: "pointer"},
        onclick: () => WB.router.go(m.from === "日志" ? "journal" : "notes", m.date)},
        el("div", {class: "small", style: {color: "var(--accent)"}, text: m.years + " 年前的今天 · " + m.from}),
        el("div", {class: "small muted", style: {marginTop: "3px"},
          text: (m.text || "（空）").replace(/[#*`>\[\]]/g, "").slice(0, 60) + ((m.text || "").length > 60 ? "…" : "")})));
    });
    return card;
  },

  /* ---------- 每日一句 ---------- */
  quoteCard(dateStr){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("quote", 18) + "<span>每日一句</span>"}));
    const body = el("div", {style: {padding: "4px 0"}});
    card.appendChild(body);
    const paint = (zh, en, src) => {
      body.innerHTML = "";
      body.appendChild(el("div", {style: {fontSize: "16px", lineHeight: 1.9}, text: zh}));
      if(en) body.appendChild(el("div", {class: "small faint", style: {marginTop: "6px", fontStyle: "italic"}, text: en}));
      if(src) body.appendChild(el("div", {class: "small faint", style: {marginTop: "6px"}, text: "—— " + src}));
    };
    const q = WB.data.quoteOf(dateStr);
    paint(q[0], q[1]);
    if(WB.daily && WB.daily.getQuote) WB.daily.getQuote(dateStr).then(r => { if(r) paint(r.zh, r.en, r.from); });
    return card;
  },

  /* ---------- 锦鲤引言（水墨和纸卡堆，灵感致敬 ThreeUI koi-studies，MIT） ---------- */
  koiCard(dateStr){
    const KOI_QUOTES = [
      ["如水而行，藏火于心。", "Move like water, keep the fire quiet."],
      ["游得慢的鱼，看得见水底的月光。", "The slow koi sees moonlight on the pond floor."],
      ["逆流不是倔强，是认得方向。", "Swimming upstream is knowing where you belong."],
      ["一池一鱼一天地，一笔一息一浮生。", "One pond, one fish, one whole world."],
      ["水深则静，人静则明。", "Deep water runs still; a still mind runs clear."],
      ["今日雨落池中，明日锦鲤过桥。", "Rain tonight, koi over the bridge tomorrow."],
    ];
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("droplet", 18) + "<span>锦鲤引言</span><span class='card-sub'>点按或拖动翻卡</span>"}));
    const stage = el("div", {class: "koi-stack"});
    card.appendChild(stage);
    let order = [];
    const paint = () => {
      stage.innerHTML = "";
      order.slice(0, 3).forEach((idx, pos) => {
        const q = KOI_QUOTES[idx];
        const cd = el("div", {class: "koi-card koi-pos" + pos},
          el("div", {class: "koi-seal", text: "鲤"}),
          el("div", {class: "koi-zh", text: q[0]}),
          el("div", {class: "koi-en", text: q[1]}),
          el("div", {class: "koi-hint", text: pos === 0 ? "→ 翻一张" : ""}));
        stage.appendChild(cd);
      });
    };
    const cycle = () => { order.push(order.shift()); paint(); };
    // 当日主句排最前，其余轮转
    const head = WB.pickDaily(KOI_QUOTES.map((_, i) => i), dateStr);
    order = KOI_QUOTES.map((_, i) => i).filter(i => i !== head);
    order.unshift(head);
    paint();
    let dragX = null;
    stage.addEventListener("pointerdown", e => { dragX = e.clientX; });
    stage.addEventListener("pointerup", e => {
      if(dragX === null) return;
      const dx = e.clientX - dragX; dragX = null;
      if(Math.abs(dx) > 8 || dx === 0) cycle();
    });
    return card;
  },

  /* ---------- 节气 + 月相 ---------- */
  termCard(dateStr){
    const term = WB.cal.termOf(dateStr);
    const moon = WB.cal.moonOf(dateStr);
    const lunar = WB.cal.lunarOf(dateStr);
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("moon-star", 18) + "<span>节气 · 月相</span>"}),
      el("div", {class: "row", style: {alignItems: "flex-start", gap: "14px"}},
        el("div", {class: "col", style: {flex: 1}},
          el("div", {style: {fontSize: "20px", fontWeight: "600"}}, term.name + (term.isTermDay ? "" : "（节气中）")),
          el("div", {class: "small muted", style: {marginTop: "6px", lineHeight: 1.8}, text: term.tip})),
        el("div", {class: "center col", style: {width: "86px", gap: "4px", textAlign: "center"}},
          el("div", {style: {fontSize: "34px"}, text: moon.icon}),
          el("div", {class: "small", text: moon.name}),
          lunar ? el("div", {class: "small faint", text: "农历" + lunar.dayCn}) : null)));
    return card;
  },

  /* ---------- 今日看点（热点/一书/播客） ---------- */
  contentCard(dateStr){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("sparkle", 18) + "<span>今日看点</span><span class='card-sub'>专注时自动隐藏</span>"}));
    const rows = el("div", {class: "col", style: {gap: "8px"}});
    card.appendChild(rows);
    const add = (label, text, route, onClick) => {
      rows.appendChild(el("div", {class: "row", style: {cursor: "pointer"},
        onclick: e => { if(onClick){ onClick(); } else if(route){ WB.router.go(route); } }},
        el("span", {class: "chip", text: label}),
        el("span", {class: "grow small ellipsis", text: text})));
    };
    let added = false;
    if(WB.hotspot && WB.hotspot.pick){
      const h = WB.hotspot.pick();
      if(h){ add("热点", h, null, () => WB.hotspot.openAll()); added = true; }
    }
    if(WB.books && WB.books.dailyPick){
      const b = WB.books.dailyPick(dateStr);
      if(b){ add("一书", b.title + " · " + b.author, "books"); added = true; }
    }
    if(WB.podcasts && WB.podcasts.dailyPick){
      const p = WB.podcasts.dailyPick(dateStr);
      if(p){ add("播客", p.name + " · " + p.intro.slice(0, 14), "podcasts"); added = true; }
    }
    if(!added){
      rows.appendChild(el("div", {class: "small faint", style: {padding: "6px 0"},
        text: "热点日报 / 今日一书 / 播客推荐，将在内容模块就绪后出现在这里"}));
    }
    return card;
  },

  /* ---------- RSS 订阅（rss2json 免费跨域通道，失败自动跳过） ---------- */
  /* 数据健康卡：上次快照 / 上次导出 / 本机占用 / 同步通道，一眼确认数据安全 */
  datacareCard(){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("shield", 18) + "<span>数据健康</span><span class='card-sub'>去数据管理</span>",
        onclick: () => WB.router.go("settings")}));
    const body = el("div", {class: "col", style: {gap: "6px"}});
    card.appendChild(body);

    body.appendChild(el("div", {class: "small"},
      el("span", {class: "faint"}, "本机占用　"), fmtBytes(storageBytes())));

    const lastExp = WB.theme.get("lastExportTs");
    body.appendChild(el("div", {class: "small"},
      el("span", {class: "faint"}, "上次导出　"),
      lastExp ? daysAgoCN(lastExp) : "还没有导出过"));
    if(!lastExp || Date.now() - lastExp > 7 * 86400000){
      body.appendChild(el("div", {class: "small", style: {color: "var(--accent)"}},
        "数据只在本机浏览器里，建议导出一份 JSON 带走"));
    }

    const wd = WB.store.get("webdav", {});
    const cloudOn = !!(window.WB_ENV && window.WB_ENV.cloudBaseUrl) && location.protocol !== "file:";
    body.appendChild(el("div", {class: "small"},
      el("span", {class: "faint"}, "同步通道　"),
      cloudOn ? "云端已连接" : (wd.url ? "WebDAV 已配置" : "未配置（可选）")));

    /* 快照在 IndexedDB，list() 是异步的：先占位，回来时先确认节点还活着（防重绘后写旧节点） */
    const snapRow = el("div", {class: "small"},
      el("span", {class: "faint"}, "每日快照　"), "…");
    body.appendChild(snapRow);
    if(WB.snapshots && WB.snapshots.list){
      WB.snapshots.list().then(list => {
        if(!snapRow.isConnected) return;
        snapRow.lastChild.textContent = list.length
          ? daysAgoCN(list[0].ts) + " · 留存 " + list.length + " 份"
          : "还没有快照";
      }).catch(() => {});
    }
    return card;
  },

  rssCard(){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("rss", 18) + "<span>RSS 订阅</span><span class='card-sub'>点此管理</span>",
        onclick: () => this.rssManage()}));
    const body = el("div", {class: "col", style: {gap: "8px"}});
    card.appendChild(body);
    const sources = WB.store.get("rssSources", []);
    if(!sources.length){
      body.appendChild(el("div", {class: "small faint", style: {padding: "4px 0"},
        text: "还没有订阅源。点标题添加：博客、公众号 RSS、任何你常读的信息流。"}));
      return card;
    }
    [0, 1, 2].forEach(() => body.appendChild(WB.ui.skLine("100%", "18px")));
    const items = [];
    let pending = sources.length;
    const paint = () => {
      if(--pending > 0) return;
      body.innerHTML = "";
      if(!items.length){
        body.appendChild(el("div", {class: "small faint", style: {padding: "4px 0"},
          text: "暂时拉不到更新（联网后自动恢复，失效的源可点标题删除）"}));
        return;
      }
      items.sort((a, b) => b.ts - a.ts).slice(0, 5).forEach(it => {
        body.appendChild(el("div", {class: "row", style: {cursor: "pointer", gap: "8px"},
          onclick: () => { try{ window.open(it.link, "_blank"); }catch(e){} }},
          el("span", {class: "chip plain", style: {flex: "none"}, text: it.src}),
          el("span", {class: "grow small ellipsis", text: it.title})));
      });
    };
    sources.forEach(s => {
      WB.net.getJSON("https://api.rss2json.com/v1/api.json?count=8&rss_url=" + encodeURIComponent(s.url),
        {cacheKey: "rss:" + s.id, cacheMs: 30 * 60000, timeout: 9000}).then(d => {
          if(d && d.status === "ok" && Array.isArray(d.items)){
            d.items.forEach(x => items.push({
              src: (s.name || (d.feed && d.feed.title) || "RSS").slice(0, 6),
              title: x.title || "（无标题）",
              link: x.link || "",
              ts: x.pubDate ? new Date(String(x.pubDate).replace(" ", "T") + "Z").getTime() || 0 : 0}));
          }
          paint();
        });
    });
    return card;
  },

  rssManage(){
    const body = el("div");
    body.appendChild(el("div", {class: "small muted", style: {marginBottom: "8px"},
      text: "贴 RSS 源地址（博客 / 公众号转出的 RSS 均可），总览卡显示最新文章。拉取走免费通道，失败自动跳过。"}));
    const name = el("input", {class: "input", placeholder: "名称（如：阮一峰的博客）", style: {maxWidth: "210px"}});
    const url = el("input", {class: "input", placeholder: "https://…/rss", style: {maxWidth: "270px"}});
    const list = el("div", {class: "list"});
    const paint = () => {
      list.innerHTML = "";
      WB.store.get("rssSources", []).forEach(s => {
        list.appendChild(el("div", {class: "list-row"},
          el("span", {class: "grow ellipsis", text: s.name}),
          el("span", {class: "small faint ellipsis", text: s.url}),
          el("button", {class: "icon-btn", html: icon("close", 14), "aria-label": "删除",
            onclick: () => { WB.collection("rssSources").remove(s.id); paint(); WB.router.render(); }})));
      });
    };
    paint();
    body.appendChild(el("div", {class: "row", style: {gap: "8px", marginBottom: "10px", flexWrap: "wrap"}}, name, url,
      el("button", {class: "btn sm primary", html: icon("plus", 14) + "<span>添加</span>",
        onclick: () => {
          const n = name.value.trim(), u = url.value.trim();
          if(!n || !u){ (!n ? name : url).focus(); return; }
          WB.collection("rssSources").add({name: n, url: /^https?:\/\//i.test(u) ? u : "https://" + u});
          name.value = ""; url.value = ""; paint();
        }})));
    body.appendChild(list);
    WB.ui.modal({title: "RSS 订阅管理", icon: "rss", content: body, wide: true,
      actions: [{label: "完成", primary: true}]});
  },

  /* ---------- 卡片管理 ---------- */
  cardManager(){
    const prefs = cardPrefs();
    const body = el("div");
    body.appendChild(el("p", {class: "small muted", style: {marginBottom: "10px"},
      text: "拖动调整总览卡片顺序；开关控制显隐。顺序即时保存。除常驻的三大件 / 今日待办 / 今日日志外，其余卡片平时收在总览底部的折叠条里。"}));
    const list = el("div", {class: "list"});
    const render = () => {
      list.innerHTML = "";
      prefs.forEach((p, i) => {
        const meta = CARD_META[p.id];
        const row = el("div", {class: "list-row", dataset: {dragId: p.id}, draggable: "true"},
          el("span", {html: icon("grip", 16), style: {color: "var(--ink-3)", cursor: "grab", display: "flex"}}),
          el("span", {html: icon(meta.icon, 17), style: {display: "flex", color: "var(--accent)"}}),
          el("span", {class: "grow", text: meta.name}),
          /* 触屏排序按钮（桌面端也可用） */
          el("span", {class: "row", style: {gap: "2px"}},
            el("button", {class: "icon-btn", html: icon("chev-left", 14), style: {transform: "rotate(90deg)"},
              onclick: () => { if(i > 0){ [prefs[i - 1], prefs[i]] = [prefs[i], prefs[i - 1]]; saveCardPrefs(prefs); render(); } }}),
            el("button", {class: "icon-btn", html: icon("chev-left", 14), style: {transform: "rotate(-90deg)"},
              onclick: () => { if(i < prefs.length - 1){ [prefs[i + 1], prefs[i]] = [prefs[i], prefs[i + 1]]; saveCardPrefs(prefs); render(); } }})),
          el("label", {class: "switch"},
            Object.assign(el("input", {type: "checkbox"}), {checked: !p.hidden,
              onchange: function(){ p.hidden = !this.checked; saveCardPrefs(prefs); }}),
            el("span", {class: "track"}), el("span", {class: "thumb"})));
        list.appendChild(row);
      });
    };
    render();
    body.appendChild(list);
    WB.ui.draggable(list, {onReorder: ids => {
      ids.forEach((id, i) => { const p = prefs.find(x => x.id === id); if(p){ prefs.splice(prefs.indexOf(p), 1); prefs.splice(i, 0, p); } });
      saveCardPrefs(prefs); render();
    }});
    /* 无 onClick → modal 自己关；关闭后由 modal:closed 订阅统一重绘（不必在这里调 render） */
    WB.ui.modal({title: "总览卡片管理", icon: "grid", content: body, wide: true,
      actions: [{label: "完成", primary: true}]});
  },
});
})();

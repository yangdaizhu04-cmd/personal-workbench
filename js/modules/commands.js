/* modules/commands.js —— ⌘K 万能命令面板：智能捕捉 / 模块跳转 / 快速翻译 / 全局搜索 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
let box = null, input = null, listEl = null, selIdx = 0, items = [];

/* ---------- 日期词解析 ---------- */
function parseDateWords(text){
  const today = WB.parseDate(WB.bizDate());
  let date = null, clean = text;
  /* getDay() 周日=0、周一=1。以前直接用 "一二三四六".indexOf 当星期值，全体差一天（"周三"解析到周二） */
  const dayIdx = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0};
  const rep = (re, fn) => {
    const m = clean.match(re);
    if(m){ const r = fn(m); if(r){ date = r; clean = clean.replace(re, "").trim(); } }
  };
  /* 重复规则与优先级要先抽走：否则"每周三"会被下面的"周X"正则当成一次性日期，
     标题只剩一个"每"字（老问题：每周一三五 → 标题"每三五"） */
  let repeat = null, prio = null;
  const wkm = clean.match(/(?:^|\s)每周([一二三四五六日天]+)/);
  if(wkm){
    repeat = {type: "weekly", days: [...new Set([...wkm[1]].map(ch => dayIdx[ch]).filter(d => d !== undefined))]};
    if(!repeat.days.length) repeat = {type: "daily", days: []};
    clean = clean.replace(wkm[0], " ").trim();
  }else{
    const dm = clean.match(/(?:^|\s)(每天|每日)/);
    if(dm){ repeat = {type: "daily", days: []}; clean = clean.replace(dm[0], " ").trim(); }
  }
  const pm = clean.match(/(?:^|\s)!([123])(?=$|\s)/);
  if(pm){ prio = {"1": "high", "2": "mid", "3": "low"}[pm[1]]; clean = clean.replace(pm[0], " ").trim(); }
  /* 允许出现在句中，但要求前面是空格或开头：「交周报 明天 15:00」能识别，
     而「整理明天的会议纪要」不会误伤（"明天"前没有分隔） */
  rep(/(?:^|\s)(大后天)/, () => WB.dateStr(new Date(today.getTime() + 3 * 86400000)));
  rep(/(?:^|\s)(后天)/, () => WB.dateStr(new Date(today.getTime() + 2 * 86400000)));
  rep(/(?:^|\s)(明天)/, () => WB.dateStr(new Date(today.getTime() + 86400000)));
  rep(/(?:^|\s)(今天)/, () => WB.bizDate());
  rep(/(?:^|\s)(\d{1,3})\s*天后/, m => WB.dateStr(new Date(today.getTime() + Number(m[1]) * 86400000)));
  rep(/\s*(下周)([一二三四五六日天])/, m => {
    const want = dayIdx[m[2]];
    const cur = today.getDay();
    let add = (7 - cur + want);
    if(add <= 0) add += 7;
    if(add < 7) add += 7; // 下周
    return WB.dateStr(new Date(today.getTime() + add * 86400000));
  });
  rep(/\s*(周|礼拜|星期)([一二三四五六日天])/, m => {
    const want = dayIdx[m[2]];
    const cur = today.getDay();
    let add = want - cur;
    if(add <= 0) add += 7;
    return WB.dateStr(new Date(today.getTime() + add * 86400000));
  });
  rep(/\s*(\d{1,2})月(\d{1,2})[日号]/, m => {
    const y = today.getFullYear();
    let d = new Date(y, +m[1] - 1, +m[2]);
    if(d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(y + 1, +m[1] - 1, +m[2]);
    return WB.dateStr(d);
  });
  /* 时刻：15:00 / 15点30 / 9点（前面要有空白或位于开头，避免误伤标题里的数字） */
  let time = "";
  const tm = clean.match(/(?:^|\s)([01]?\d|2[0-3])[:：点](\d{1,2})?分?/);
  if(tm){
    time = String(Number(tm[1])).padStart(2, "0") + ":" + (tm[2] ? String(Number(tm[2])).padStart(2, "0") : "00");
    clean = clean.replace(tm[0], " ").trim();
  }
  return {date, clean, time, repeat, prio};
}

/* ---------- 数据收集 ---------- */
function searchAll(kw){
  const out = [];
  const k = kw.toLowerCase();
  WB.store.get("todos", []).forEach(t => {
    if(t.title.toLowerCase().includes(k)) out.push({module: "todos", icon: "check-circle", label: t.title, hint: "待办 · " + (t.date || ""), go: () => WB.router.go("todos")});
  });
  WB.store.get("notes", []).forEach(n => {
    if(n.content.toLowerCase().includes(k)) out.push({module: "notes", icon: "edit", label: n.content.slice(0, 40), hint: "笔记", go: () => WB.router.go("notes")});
  });
  WB.store.get("journals", []).forEach(j => {
    const text = (j.free || "") + (j.done || "") + (j.problems || "");
    if(text.toLowerCase().includes(k)) out.push({module: "journal", icon: "book", label: text.slice(0, 40), hint: "日志 · " + j.date, go: () => WB.router.go("journal", j.date)});
  });
  WB.store.get("ledger", []).forEach(l => {
    if((l.note || "").toLowerCase().includes(k) || String(l.amount) === kw)
      out.push({module: "ledger", icon: "wallet", label: (l.note || "账单") + " ¥" + l.amount, hint: "账单 · " + l.date, go: () => WB.router.go("ledger")});
  });
  return out.slice(0, 8);
}

/* ---------- 命令构建 ---------- */
function buildItems(q){
  const out = [];
  const t = q.trim();
  // 模块跳转
  WB.router.allRoutes();
  const routes = WB.router.allRoutes();
  Object.values(routes).forEach(m => {
    if(m.hidden) return;
    if(!t || (m.title || "").includes(t) || m.id.includes(t.toLowerCase()))
      out.push({group: "跳转", icon: m.icon || "circle", label: m.title, hint: "打开模块",
        exec: () => WB.router.go(m.id)});
  });
  // 沉浸专注（番茄钟全屏层）：空查询时会额外调一次（截断之后），防重靠 group 判断
  const focusItems = () => {
    if(!WB.immersive || !WB.pomodoro) return;
    if(out.some(i => i.group === "专注")) return;
    if(!t || "沉浸专注番茄".includes(t)){
      if(WB.immersive.isActive())
        out.push({group: "专注", icon: "timer", label: "退出沉浸专注", hint: "Esc",
          exec: () => WB.immersive.exit()});
      else if(WB.pomodoro.state())
        out.push({group: "专注", icon: "timer", label: "进入沉浸专注", hint: "F",
          exec: () => WB.immersive.enter()});
    }
  };
  focusItems();
  // 沉浸场景（12 套）：只在有查询词时出现 —— 否则空面板会被 12 条场景命令刷屏。
  // 与「窗景」组区分开：那是 ThreeUI 的窗景页，这里是番茄钟沉浸层的场景
  if(WB.immersive && WB.immersive.pick){
    const scenes = WB.immersive.scenes || {};
    (WB.immersive.order || []).forEach(id => {
      const name = scenes[id];
      if(!name || !t || !name.includes(t)) return;
      out.push({group: "沉浸场景", icon: "image", label: "场景 · " + name,
        hint: WB.immersive.isActive() ? "立即切换" : "设为沉浸场景",
        exec: () => WB.immersive.pick(id)});
    });
  }
  // 窗景（ThreeUI 场景页）
  if(WB.scenes){
    Object.entries(WB.scenes.SCENES).forEach(([key, s]) => {
      if(!t || s.title.includes(t)) out.push({group: "窗景", icon: "image", label: s.title, hint: "打开场景页",
        exec: () => WB.scenes.open(key)});
    });
  }
  /* 仪式：晨间 / 收工都能从这里唤起（以前只有开机自动弹一次，误关当天就没入口了）。
     只在有查询词时出现，空面板不堆条目 */
  if(t && WB.rituals){
    [["晨间仪式", "sun", () => WB.rituals.startMorning()], ["收工仪式", "moon", () => WB.rituals.startOffwork()]]
      .forEach(([name, ic, run]) => {
        if(name.includes(t)) out.push({group: "仪式", icon: ic, label: name, hint: "打开", exec: run});
      });
  }
  if(!t){
    out.length = Math.min(out.length, 6);
    /* 这三条是说明文字，不是命令：标 info 后不可点、上下键会跳过（以前点下去只是把面板关掉，像点错了） */
    out.push({group: "捕捉", icon: "plus", label: "输入文字回车 → 新待办（明天/周五/15:00/每周一/!1/3天后）", hint: "", info: true});
    out.push({group: "捕捉", icon: "edit", label: "以「记 」开头回车 → 新笔记（#标签自动归类）", hint: "", info: true});
    out.push({group: "捕捉", icon: "translate", label: "「翻译 xxx」→ 中英互译", hint: "", info: true});
    focusItems();     // 放在 out.length 截断之后，否则会被砍掉
    return out;
  }
  // 翻译
  const tr = t.match(/^翻译\s+(.+)/);
  if(tr){
    out.push({group: "翻译", icon: "translate", label: "翻译：" + tr[1], hint: "回车执行", translate: tr[1]});
  }
  // 捕捉
  if(!tr){
    if(/^(记|笔)\s+/.test(t)){
      const content = t.replace(/^(记|笔)\s+/, "");
      out.push({group: "捕捉", icon: "edit", label: "存为笔记：" + content, hint: "回车保存",
        exec: () => { WB.collection("notes").add({content, tags: WB.md.extractTags(content)}); WB.ui.toast("已存入笔记"); if(WB.badgeCheck) WB.badgeCheck(); WB.router.render(); }});
    }else{
      const parsed = parseDateWords(t);
      const title = parsed.clean || t;
      const date = parsed.date || WB.bizDate();
      /* 日期/时刻/重复一句话成型：「交周报 明天 15:00」→ 明天 15:00；「喝水 每天」→ 每天重复；
         !1/!2/!3 映射高/中/低（todos.js 的 repeat 结构：{type:"daily"|"weekly", days:[周日=0]}） */
      const repTxt = parsed.repeat
        ? (parsed.repeat.type === "daily" ? "每天" : "每周" + parsed.repeat.days.map(d => "日一二三四五六"[d]).join(""))
        : "";
      let when = (parsed.date ? WB.relDayLabel(parsed.date) : "") + (parsed.time ? (parsed.date ? " " : "今天 ") + parsed.time : "");
      if(repTxt) when += (when ? " · " : "") + repTxt;
      out.push({group: "捕捉", icon: "check-circle",
        label: "新待办：" + title + (when ? "（" + when + "）" : ""),
        hint: "回车添加",
        exec: () => {
          WB.collection("todos").add({title, prio: parsed.prio || "mid", date,
            time: parsed.time || "", done: false, repeat: parsed.repeat || {type: "none", days: []}});
          WB.ui.toast("已添加到 " + WB.relDayLabel(date) + (parsed.time ? " " + parsed.time : "")
            + (repTxt ? " · " + repTxt : "") + (parsed.prio ? " · " + {"high": "高", "mid": "中", "low": "低"}[parsed.prio] + "优先级" : ""));
          WB.router.render();
        }});
      out.push({group: "捕捉", icon: "edit", label: "或存为笔记：" + t, hint: "Shift+回车", alt: true,
        exec: () => { WB.collection("notes").add({content: t, tags: WB.md.extractTags(t)}); WB.ui.toast("已存入笔记"); if(WB.badgeCheck) WB.badgeCheck(); WB.router.render(); }});
    }
  }
  // 搜索
  searchAll(t).forEach(r => out.push({group: "搜索", icon: r.icon, label: r.label, hint: r.hint, exec: r.go}));
  return out;
}

/* ---------- 翻译 ---------- */
async function doTranslate(text){
  WB.ui.toast("翻译中…");
  const res = await WB.net.getJSON("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=zh|en", {cacheKey: "tr:" + text, timeout: 8000});
  let out;
  if(res && res.responseData){
    out = res.responseData.translatedText;
  }else{
    // 反向：可能是英→中
    const res2 = await WB.net.getJSON("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|zh", {cacheKey: "tre:" + text});
    out = res2 && res2.responseData ? res2.responseData.translatedText : null;
  }
  if(out){
    WB.copyText(out);
    WB.ui.modal({title: "翻译结果", icon: "translate",
      content: '<div style="font-size:17px;line-height:1.9">' + esc(out) + "</div>",
      actions: [{label: "已复制，关闭", primary: true, onClick: () => {}}]});
  }else{
    WB.ui.toast("翻译暂不可用（需联网）", "warn");
  }
}

/* ---------- 打开/关闭 ---------- */
/* closed | open | leaving：退场期间 modalOpen() 必须已经算「关掉了」，
   否则 .leaving 的 200ms 内快捷键仍会被弹窗栈拦住（踩坑 #028） */
let phase = "closed";
let token = 0;
let firstPaint = false;
function isOpen(){ return phase === "open"; }

function open(){
  const root = WB.$("#cmdk-root");
  token++;
  phase = "open";
  root.hidden = false;
  root.innerHTML = "";
  const scrim = el("div", {class: "cmdk-scrim", onclick: close});
  input = el("input", {placeholder: "输入待办 / 记笔记 / 模块名 / 翻译 xxx / 搜索…"});
  input.addEventListener("input", WB.debounce(() => paint(), 120));
  /* 上下键跳过「说明行」（info 项只是提示，不可选不可执行） */
  const step = dir => {
    for(let i = selIdx + dir; i >= 0 && i < items.length; i += dir){
      if(!items[i].info){ selIdx = i; paintSel(); return; }
    }
  };
  input.addEventListener("keydown", e => {
    if(e.key === "ArrowDown"){ e.preventDefault(); step(1); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); step(-1); }
    else if(e.key === "Enter"){
      e.preventDefault();
      /* Shift+回车 = 执行列表里的「备选动作」（带 alt 标记的那条，目前是"存为笔记"）。
         以前这条提示只是文案，回车根本不看 shiftKey，照提示按会多出一条待办 */
      const it = e.shiftKey ? (items.find(x => x.alt) || items[selIdx]) : items[selIdx];
      if(!it || it.info) return;
      if(it.translate !== undefined){ doTranslate(it.translate); close(); return; }
      if(it.exec){
        close();
        it.exec();
      }
    }
  });
  listEl = el("div", {class: "cmdk-list"});
  box = el("div", {class: "cmdk"},
    el("div", {class: "cmdk-input"}, el("span", {html: icon("search", 19)}), input),
    listEl);
  root.appendChild(scrim);
  root.appendChild(box);
  WB.ui.syncScrim();
  selIdx = 0;
  firstPaint = true;      // 错峰只在首次列表上播；输入重绘时逐条重播会很吵（2.4）
  paint();
  firstPaint = false;
  setTimeout(() => input.focus(), 50);
}
function close(){
  if(phase !== "open") return;
  phase = "leaving";
  const root = WB.$("#cmdk-root");
  const tk = ++token;
  const panel = box, scrim = root.querySelector(".cmdk-scrim");
  const done = () => {
    if(tk !== token) return;        // 退场期间又打开了新面板，别把新的清掉
    phase = "closed";
    root.hidden = true;
    root.innerHTML = "";
    input = null; box = null; listEl = null;
    WB.ui.syncScrim();
  };
  // 退场动画 200ms，但「已关闭」的状态立刻生效（踩坑 #028）
  if(!panel || WB.ui.motionOff()){ done(); return; }
  panel.classList.add("leaving");
  if(scrim) scrim.classList.add("leaving");
  setTimeout(done, 200);
}
function paint(){
  // 输入防抖 120ms：若在这 120ms 内回车关闭，input/listEl 已被清空，
  // 旧的防抖回调仍会触发 → 必须守卫，否则 TypeError（原实现漏了这一层）
  if(!input || !listEl) return;
  items = buildItems(input.value);
  selIdx = Math.min(selIdx, Math.max(0, items.length - 1));
  listEl.innerHTML = "";
  let lastGroup = "";
  items.forEach((it, i) => {
    if(it.group !== lastGroup){
      lastGroup = it.group;
      listEl.appendChild(el("div", {class: "cmdk-group", text: it.group}));
    }
    const row = el("div", {class: "cmdk-item" + (i === selIdx ? " sel" : "") + (it.info ? " is-info" : ""), dataset: {idx: i}},
      el("span", {html: icon(it.icon, 17)}),
      el("span", {text: it.label}),
      it.hint ? el("span", {class: "ci-hint", text: it.hint}) : null);
    if(!it.info){   // 说明行不参与点击与悬停选中
      row.addEventListener("click", () => {
        if(it.translate !== undefined){ doTranslate(it.translate); close(); return; }
        close(); it.exec && it.exec();
      });
      row.addEventListener("mousemove", () => { selIdx = i; paintSel(); });
    }
    listEl.appendChild(row);
  });
  if(!items.length) listEl.appendChild(el("div", {class: "cmdk-item", text: "没有匹配结果"}));
  if(firstPaint) WB.ui.staggerIn(listEl, 30, 0);
}
function paintSel(){
  listEl.querySelectorAll(".cmdk-item").forEach(n => n.classList.toggle("sel", Number(n.dataset.idx) === selIdx));
}

WB.registerModule({id: "commands-internal", title: "命令面板", icon: "search", hidden: true, render(){}});
WB.commands = {open, close, isOpen, parseDateWords};
})();

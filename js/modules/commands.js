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
  const cnNum = "一二三四五六日天";
  const rep = (re, fn) => {
    const m = clean.match(re);
    if(m){ const r = fn(m); if(r){ date = r; clean = clean.replace(re, "").trim(); } }
  };
  rep(/^\s*(大后天)/, () => WB.dateStr(new Date(today.getTime() + 3 * 86400000)));
  rep(/^\s*(后天)/, () => WB.dateStr(new Date(today.getTime() + 2 * 86400000)));
  rep(/^\s*(明天)/, () => WB.dateStr(new Date(today.getTime() + 86400000)));
  rep(/^\s*(今天)/, () => WB.bizDate());
  rep(/\s*(下周|下周|下周)([一二三四五六日天])/, m => {
    const want = cnNum.indexOf(m[2]);
    const cur = today.getDay();
    let add = (7 - cur + want);
    if(add <= 0) add += 7;
    if(add < 7) add += 7; // 下周
    return WB.dateStr(new Date(today.getTime() + add * 86400000));
  });
  rep(/\s*(周|礼拜|星期)([一二三四五六日天])/, m => {
    const want = cnNum.indexOf(m[2]);
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
  return {date, clean};
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
  if(!t){
    out.length = Math.min(out.length, 6);
    out.push({group: "捕捉", icon: "plus", label: "输入文字回车 → 新待办（支持 明天/后天/周五/3月5日）", hint: "",
      exec: () => {}});
    out.push({group: "捕捉", icon: "edit", label: "以「记 」开头回车 → 新笔记（#标签自动归类）", hint: "",
      exec: () => {}});
    out.push({group: "捕捉", icon: "translate", label: "「翻译 xxx」→ 中英互译", hint: "",
      exec: () => {}});
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
        exec: () => { WB.collection("notes").add({content, tags: WB.md.extractTags(content)}); WB.ui.toast("已存入笔记"); if(WB.badgeCheck) WB.badgeCheck(); }});
    }else{
      const parsed = parseDateWords(t);
      const title = parsed.clean || t;
      const date = parsed.date || WB.bizDate();
      out.push({group: "捕捉", icon: "check-circle",
        label: "新待办：" + title + (parsed.date ? "（" + WB.relDayLabel(parsed.date) + "）" : ""),
        hint: "回车添加",
        exec: () => { WB.collection("todos").add({title, prio: "mid", date, done: false}); WB.ui.toast("已添加到 " + WB.relDayLabel(date)); WB.router.render(); }});
      out.push({group: "捕捉", icon: "edit", label: "或存为笔记：" + t, hint: "Shift+回车",
        note: content0(t),
        exec: () => { WB.collection("notes").add({content: t, tags: WB.md.extractTags(t)}); WB.ui.toast("已存入笔记"); }});
    }
  }
  // 搜索
  searchAll(t).forEach(r => out.push({group: "搜索", icon: r.icon, label: r.label, hint: r.hint, exec: r.go}));
  return out;
  function content0(x){ return x; }
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
  input.addEventListener("keydown", e => {
    if(e.key === "ArrowDown"){ e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); paintSel(); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); paintSel(); }
    else if(e.key === "Enter"){
      e.preventDefault();
      const it = items[selIdx];
      if(!it) return;
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
    const row = el("div", {class: "cmdk-item" + (i === selIdx ? " sel" : ""), dataset: {idx: i}},
      el("span", {html: icon(it.icon, 17)}),
      el("span", {text: it.label}),
      it.hint ? el("span", {class: "ci-hint", text: it.hint}) : null);
    row.addEventListener("click", () => {
      if(it.translate !== undefined){ doTranslate(it.translate); close(); return; }
      close(); it.exec && it.exec();
    });
    row.addEventListener("mousemove", () => { selIdx = i; paintSel(); });
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

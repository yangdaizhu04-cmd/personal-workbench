/* modules/todos.js —— 待办事项：清单 / 子任务 / 重复 / 时刻提醒 / 四象限 / 拖拽排序 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const todos = WB.collection("todos");
const lists = WB.collection("todoLists");
const PRIO = {high: {label: "高", cls: "prio-high"}, mid: {label: "中", cls: "prio-mid"}, low: {label: "低", cls: "prio-low"}};
/* 拖拽排序值：手动排过的项按 order 走，没排过的排到最后（不影响它原本的优先级顺序） */
const ordOf = t => (typeof t.order === "number" ? t.order : 1e6);
const viewState = {filter: "today", mode: "list", listId: "", q: "", bulk: false, sel: new Set(), showAllDone: false};
/* 由 render 注入的"只重绘列表"函数：搜索框输入时用它刷新列表，
   不能走 WB.router.render()（那会重建整行、输入框失焦，打一个字就断） */
let repaintList = null;

/* ---------- 业务工具 ---------- */
function allLists(){ return lists.all(); }
function listOf(id){ return allLists().find(l => l.id === id) || null; }

/* 重复任务到期自动出现：把该出现而未"实例化"的重复任务复制为当日实例 */
function materializeRepeats(){
  const today = WB.bizDate();
  const all = todos.all();
  const changed = [];
  const templates = all.filter(t => t.repeat && t.repeat.type !== "none" && t.repeatOf === undefined);
  templates.forEach(tpl => {
    const exists = all.some(t => t.repeatOf === tpl.id && t.date === today);
    if(exists) return;
    const dow = WB.parseDate(today).getDay();
    const due = tpl.repeat.type === "daily" ||
      (tpl.repeat.type === "weekly" && (tpl.repeat.days || []).includes(dow));
    // 上次实例的日期（用于避免漏生成多天）
    const lastInst = all.filter(t => t.repeatOf === tpl.id).map(t => t.date).sort().pop();
    if(!due) return;
    if(lastInst && lastInst >= today) return;
    const inst = todos.add({
      title: tpl.title, prio: tpl.prio, date: today, listId: tpl.listId,
      time: tpl.time, remindAhead: tpl.remindAhead, important: tpl.important, urgent: tpl.urgent,
      subtasks: (tpl.subtasks || []).map(s => ({id: WB.uid(), title: s.title, done: false})),
      repeatOf: tpl.id, repeat: tpl.repeat,
    });
    changed.push(inst);
  });
  return changed;
}

function nextRepeatDate(t, fromDate){
  if(t.repeat.type === "daily") return WB.addDaysStr(fromDate, 1);
  if(t.repeat.type === "weekly"){
    const days = (t.repeat.days || []).slice().sort((a, b) => a - b);
    for(let i = 1; i <= 7; i++){
      const d = WB.addDaysStr(fromDate, i);
      if(days.includes(WB.parseDate(d).getDay())) return d;
    }
  }
  return WB.addDaysStr(fromDate, 1);
}

function checkTodo(t, ev){
  const done = !t.done;
  if(done){
    if(t.repeatOf){ // 重复任务的当日实例：完成即可
      todos.update(t.id, {done: true, doneAt: Date.now()});
    }else if(t.repeat && t.repeat.type !== "none"){
      /* 模板：不能新建一个「下一期模板」—— 那个新对象没有 repeatOf，会被 materializeRepeats
         当成模板立刻物化，于是今天凭空多出一条重复待办（勾一次多一条）。
         正确做法是把模板自身的日期推进到下一期，并把今天已生成的实例标记完成。
         推进基准取「模板日期与今天的较晚者」：模板过期时按今天算（下一期才是真的下一期），
         模板在将来时按它自己算（不会被勾一下反而倒退） */
      const base = t.date > WB.bizDate() ? t.date : WB.bizDate();
      todos.update(t.id, {date: nextRepeatDate(t, base)});
      const inst = todos.all().find(x => x.repeatOf === t.id && x.date === WB.bizDate());
      if(inst) todos.update(inst.id, {done: true, doneAt: Date.now()});
    }else{
      todos.update(t.id, {done: true, doneAt: Date.now()});
    }
    if(ev) WB.ui.starBurst(ev.clientX, ev.clientY);
    WB.ui.chime("done");
    if(WB.coins) WB.coins.forTodo(t, true);
    const today = WB.bizDate();
    const todays = todos.all().filter(x => x.date === today && !x.repeatOf);
    if(todays.length && todays.every(x => x.done)) WB.ui.celebrate({big: true});
  }else{
    todos.update(t.id, {done: false, doneAt: undefined});
    if(WB.coins) WB.coins.forTodo(t, false);
  }
  WB.bus.emit("view:dirty");
  if(WB.badgeCheck) WB.badgeCheck();   // 以前漏了这句：完成 500 件也不解锁「五百件事」
}

/* ---------- 添加/编辑弹窗 ---------- */
function todoModal(existing, presets){
  const isNew = !existing;
  /* 新建时沿用上次用过的清单与提前量：天天记在同一个清单里的人，不必每次重选两下 */
  const last = WB.theme.get("todoLast") || {};
  const t = Object.assign({
    title: "", prio: "mid", date: WB.bizDate(), listId: last.listId || "", time: "", remindAhead: last.remindAhead || "0",
    repeat: {type: "none", days: []}, subtasks: [], important: false, urgent: false, note: "",
  }, existing || {}, presets || {});
  if(t.prio === "high"){ t.important = true; t.urgent = true; }

  const body = el("div");
  const title = el("input", {class: "input", value: t.title, placeholder: "要做什么？"});
  const prio = el("div", {class: "seg"});
  ["high", "mid", "low"].forEach(p => prio.appendChild(el("button", {
    text: PRIO[p].label, dataset: {v: p},
    onclick: () => { prio.querySelectorAll("button").forEach(b => b.classList.remove("on")); prio.querySelector(`[data-v="${p}"]`).classList.add("on"); },
  })));
  prio.querySelector(`[data-v="${t.prio}"]`).classList.add("on");

  const dateInput = el("input", {type: "date", class: "input", value: t.date});
  const timeInput = el("input", {type: "time", class: "input", value: t.time || ""});
  const aheadSel = el("select", {class: "input"},
    [["0", "准点提醒"], ["5", "提前 5 分钟"], ["10", "提前 10 分钟"], ["30", "提前 30 分钟"]].map(([v, l]) =>
      el("option", {value: v, text: l, selected: t.remindAhead === v})));

  const listSel = el("select", {class: "input"}, el("option", {value: "", text: "无清单"}),
    allLists().map(l => el("option", {value: l.id, text: l.name, selected: t.listId === l.id})));

  /* 重复 */
  const repSeg = el("div", {class: "seg"});
  const repDays = el("div", {class: "row", style: {gap: "4px", marginTop: "6px", display: "none"}});
  ["日", "一", "二", "三", "四", "五", "六"].forEach((d, i) => {
    const on = (t.repeat.days || []).includes(i);
    repDays.appendChild(el("button", {
      class: "chip clickable" + (on ? "" : " plain"), text: d, dataset: {dow: i},
      onclick: e => e.target.classList.toggle("plain"),
    }));
  });
  ["none", "daily", "weekly"].forEach((v, i) => repSeg.appendChild(el("button", {
    text: ["不重复", "每天", "每周几"][i], dataset: {v},
    onclick: () => {
      repSeg.querySelectorAll("button").forEach(b => b.classList.remove("on"));
      repSeg.querySelector(`[data-v="${v}"]`).classList.add("on");
      repDays.style.display = v === "weekly" ? "flex" : "none";
    },
  })));
  repSeg.querySelector(`[data-v="${t.repeat.type}"]`).classList.add("on");
  if(t.repeat.type === "weekly") repDays.style.display = "flex";

  /* 子任务 */
  const subList = el("div", {class: "col", style: {gap: "6px"}});
  const renderSubs = () => {
    subList.innerHTML = "";
    t.subtasks.forEach((s, i) => {
      subList.appendChild(el("div", {class: "row"},
        el("input", {class: "input grow", value: s.title, placeholder: "步骤 " + (i + 1),
          oninput: e => { s.title = e.target.value; }}),
        el("button", {class: "icon-btn", html: icon("close", 14),
          onclick: () => { t.subtasks.splice(i, 1); renderSubs(); }})));
    });
  };
  renderSubs();

  body.appendChild(el("div", {class: "field"}, el("label", {text: "标题"}), title));
  body.appendChild(el("div", {class: "field-row"},
    el("div", {class: "field"}, el("label", {text: "优先级"}), prio),
    el("div", {class: "field"}, el("label", {text: "日期"}), dateInput)));
  body.appendChild(el("div", {class: "field-row"},
    el("div", {class: "field"}, el("label", {text: "时刻（可选，到点提醒）"}), timeInput),
    el("div", {class: "field"}, el("label", {text: "提前量"}), aheadSel)));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "所属清单"}), listSel));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "重复"}), repSeg, repDays));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "子任务"}),
    subList,
    el("button", {class: "btn sm", style: {marginTop: "6px"}, html: icon("plus", 13) + "<span>添加步骤</span>",
      onclick: () => { t.subtasks.push({id: WB.uid(), title: "", done: false}); renderSubs(); }})));

  const m = WB.ui.modal({
    title: isNew ? "新任务" : "编辑任务", icon: "check-circle", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        // 删完给撤销条兜底（回收站 30 天），不再拦一次确认
        todos.remove(t.id);
        m.close(); WB.router.render();
        return true; // 不自动关
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const titleV = title.value.trim();
        if(!titleV){ title.focus(); return; }
        const prioV = prio.querySelector(".on").dataset.v;
        const repV = repSeg.querySelector(".on").dataset.v;
        const days = Array.from(repDays.querySelectorAll(".chip:not(.plain)")).map(b => Number(b.dataset.dow));
        const patch = {
          title: titleV, prio: prioV, date: dateInput.value || WB.bizDate(),
          time: timeInput.value, remindAhead: aheadSel.value, listId: listSel.value,
          repeat: {type: repV, days},
          important: prioV === "high" ? true : prioV === "mid",
          urgent: prioV === "high",
          subtasks: t.subtasks.filter(s => s.title.trim()),
        };
        if(isNew) todos.add(patch);
        else todos.update(t.id, patch);
        // 记住这次的选择，供下次新建时默认沿用
        WB.theme.set("todoLast", {listId: patch.listId || "", remindAhead: patch.remindAhead || "0"});
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => title.focus(), 60);
}

/* 多选：切换一条的选中态，顺手更新操作条计数，再只重绘列表（不整页重建，连点不闪） */
let selCountNode = null;
function togglePick(id){
  if(viewState.sel.has(id)) viewState.sel.delete(id); else viewState.sel.add(id);
  if(selCountNode) selCountNode.textContent = "已选 " + viewState.sel.size + " 项";
  if(repaintList) repaintList();
}

/* 清单管理 */
function listManager(){
  const body = el("div");
  const row0 = el("div", {class: "row"});
  const nameIn = el("input", {class: "input grow", placeholder: "清单名称，如：工作 / 生活"});
  const colorIn = el("input", {type: "color", value: "#7fa3bd", style: {width: "40px", height: "34px", border: "none", background: "none", cursor: "pointer"}});
  row0.appendChild(nameIn); row0.appendChild(colorIn);
  row0.appendChild(el("button", {class: "btn sm primary", text: "新建", onclick: () => {
    const name = nameIn.value.trim();
    if(!name) return;
    lists.add({name, color: colorIn.value});
    nameIn.value = ""; WB.router.render(); openAgain();
  }}));
  body.appendChild(row0);
  body.appendChild(el("div", {class: "small faint", style: {margin: "8px 0"}, text: "已建清单："}));
  const lst = el("div", {class: "list"});
  allLists().forEach(l => {
    lst.appendChild(el("div", {class: "list-row"},
      el("span", {class: "prio-dot", style: {background: l.color}}),
      el("span", {class: "grow", text: l.name}),
      el("span", {class: "small faint", text: todos.all().filter(t => t.listId === l.id && !t.done).length + " 项"}),
      el("button", {class: "icon-btn", html: icon("trash", 15), onclick: () => {
        WB.ui.confirmBox(`删除清单「${esc(l.name)}」？清单下任务保留，仅解除关联。`, {danger: true, okLabel: "删除"}).then(ok => {
          if(ok){
            lists.remove(l.id);
            todos.all().filter(t => t.listId === l.id).forEach(t => todos.update(t.id, {listId: ""}));
            WB.router.render(); openAgain();
          }
        });
      }})));
  });
  body.appendChild(lst);

  function openAgain(){ setTimeout(() => listManager(), 50); }
  WB.ui.modal({title: "清单管理", icon: "folder", content: body,
    actions: [{label: "完成", primary: true}]});   // 无 onClick 才会自动关；刷新走 modal:closed 订阅
}

function todoRow(t){
  const l = listOf(t.listId);
  const subDone = (t.subtasks || []).filter(s => s.done).length;
  const subTotal = (t.subtasks || []).length;
  const picked = viewState.bulk && viewState.sel.has(t.id);
  const row = el("div", {class: "list-row" + (picked ? " picked" : ""), dataset: {dragId: t.id}});
  if(viewState.bulk){
    /* 多选模式：这一行不参与拖拽，首列换成选择框 */
    row.appendChild(el("button", {
      class: "icon-btn", html: icon(picked ? "check-circle" : "circle", 20),
      "aria-label": picked ? "取消选择" : "选择这条",
      style: {color: picked ? "var(--accent)" : "var(--ink-3)", flex: "none"},
      onclick: () => togglePick(t.id),
    }));
  }else{
    WB.enableDrag(row);
    row.appendChild(el("button", {
      html: icon(t.done ? "check-circle" : "circle", 21),
      "aria-label": t.done ? "标记未完成" : "标记完成",
      style: {color: t.done ? "var(--ok)" : "var(--accent)", display: "flex", flex: "none",
        transition: "transform var(--dur-tap) var(--ease-pop)"},
      onclick: e => checkTodo(t, e),
    }));
  }
  const mid = el("div", {class: "grow", style: {minWidth: 0, cursor: "pointer"},
    onclick: () => { viewState.bulk ? togglePick(t.id) : todoModal(t); }});   // 多选时整行都是热区
  const titleRow = el("div", {class: "row", style: {gap: "7px"}});
  if(!t.done) titleRow.appendChild(el("span", {class: "prio-dot " + PRIO[t.prio || "mid"].cls}));
  titleRow.appendChild(el("span", {
    class: t.done ? "faint" : "", style: t.done ? {textDecoration: "line-through"} : {},
    text: t.title}));
  if(t.repeat && t.repeat.type !== "none") titleRow.appendChild(el("span", {html: icon("repeat", 13), style: {display: "flex", color: "var(--ink-3)"}}));
  mid.appendChild(titleRow);
  const meta = el("div", {class: "row small", style: {gap: "8px", marginTop: "2px", flexWrap: "wrap"}});
  if(t.time) meta.appendChild(el("span", {class: "faint", text: "⏰ " + t.time + (t.remindAhead && t.remindAhead !== "0" ? "（提前" + t.remindAhead + "分）" : "")}));
  if(l) meta.appendChild(el("span", {style: {color: l.color}, text: "· " + l.name}));
  if(subTotal) meta.appendChild(el("span", {class: "faint", text: "☑ " + subDone + "/" + subTotal}));
  if(t.date && t.date !== WB.bizDate() && !t.done) meta.appendChild(el("span", {class: "faint", text: WB.relDayLabel(t.date)}));
  if(t.done && t.doneAt) meta.appendChild(el("span", {class: "faint", text: "完成于 " + WB.fmtTime(t.doneAt)}));
  if(meta.children.length) mid.appendChild(meta);
  row.appendChild(mid);
  if(subTotal){
    row.appendChild(el("button", {class: "small faint", text: subDone + "/" + subTotal,
      onclick: () => subtaskModal(t), style: {flex: "none"}}));
  }
  row.appendChild(el("button", {class: "icon-btn", html: icon("trash", 15), title: "删除",
    onclick: () => {
      todos.remove(t.id);        // 「已移入回收站 · 撤销」由 02-store.js 的 toTrash 统一弹
      WB.router.render();
    }}));
  return row;
}

/* 子任务弹窗 */
function subtaskModal(t){
  const body = el("div");
  const list = el("div", {class: "list"});
  const render = () => {
    list.innerHTML = "";
    (t.subtasks || []).forEach((s, i) => {
      list.appendChild(el("div", {class: "list-row"},
        el("button", {html: icon(s.done ? "check-circle" : "circle", 19),
          style: {color: s.done ? "var(--ok)" : "var(--ink-3)", display: "flex"},
          onclick: () => { s.done = !s.done; persist(); render(); }}),
        el("span", {class: "grow" + (s.done ? " faint" : ""), style: s.done ? {textDecoration: "line-through"} : {}, text: s.title}),
        el("button", {class: "icon-btn", html: icon("close", 13), onclick: () => { t.subtasks.splice(i, 1); persist(); render(); }})));
    });
    if(!t.subtasks.length) list.appendChild(el("div", {class: "small faint", text: "还没有步骤"}));
  };
  const input = el("input", {class: "input", placeholder: "添加一个步骤，回车确认"});
  input.addEventListener("keydown", e => {
    if(e.key === "Enter" && input.value.trim()){
      t.subtasks = t.subtasks || [];
      t.subtasks.push({id: WB.uid(), title: input.value.trim(), done: false});
      input.value = ""; persist(); render();
    }
  });
  function persist(){
    todos.update(t.id, {subtasks: t.subtasks});
    const parent = todos.find(t.id);
    if(parent) Object.assign(t, parent);
  }
  body.appendChild(el("div", {class: "field"}, el("label", {text: "新增步骤"}), input));
  body.appendChild(list);
  WB.ui.modal({title: "子任务 · " + t.title, icon: "list", content: body,
    actions: [{label: "完成", primary: true}]});   // 无 onClick 才会自动关；行尾 n/m 由 modal:closed 订阅刷新
  render();
}

/* ---------- 四象限视图 ---------- */
function quadrantView(view){
  const today = WB.bizDate();
  const all = todos.all().filter(t => !t.done && t.date <= WB.addDaysStr(today, 7));
  const quads = [
    {key: "iu", title: "重要且紧急", hint: "立刻做", imp: true, urg: true, color: "var(--danger)"},
    {key: "in", title: "重要不紧急", hint: "安排做", imp: true, urg: false, color: "var(--accent)"},
    {key: "nu", title: "不重要但紧急", hint: "委托/快速做", imp: false, urg: true, color: "var(--warn)"},
    {key: "nn", title: "不重要不紧急", hint: "少做", imp: false, urg: false, color: "var(--ink-3)"},
  ];
  const grid = el("div", {class: "grid grid-2"});
  quads.forEach(q => {
    const arr = all.filter(t => (t.important ? true : false) === q.imp && (t.urgent ? true : false) === q.urg);
    const card = el("div", {class: "card", dataset: {quad: q.key}, style: {minHeight: "220px"}});
    card.appendChild(el("div", {class: "card-title",
      html: "<span style='width:9px;height:9px;border-radius:50%;background:" + q.color + "'></span><span>" + q.title + "</span><span class='card-sub'>" + q.hint + " · " + arr.length + " 项</span>"}));
    const list = el("div", {class: "list", dataset: {quad: q.key}});
    arr.forEach(t => {
      const row = el("div", {class: "list-row", dataset: {dragId: t.id}, draggable: "true"},
        el("button", {html: icon("circle", 19), style: {color: "var(--accent)", display: "flex"}, onclick: e => checkTodo(t, e)}),
        el("span", {class: "grow small ellipsis", text: t.title, title: t.title, onclick: () => todoModal(t), style: {cursor: "pointer"}}),
        t.date ? el("span", {class: "small faint nowrap", text: WB.relDayLabel(t.date)}) : null);
      list.appendChild(row);
    });
    card.appendChild(list);
    if(!arr.length) card.appendChild(el("div", {class: "small faint center", style: {padding: "24px 0"}, text: "拖任务到这里"}));
    grid.appendChild(card);
  });
  view.appendChild(el("div", {class: "small faint", style: {margin: "0 4px 12px"},
    text: "拖动任务到四象限，自动调整优先级（重要紧急→高，重要不紧急→中，其余→低）。范围：今明七天内的未完成任务。"}));
  view.appendChild(grid);

  /* 跨象限拖拽 */
  grid.addEventListener("dragstart", e => {
    const row = e.target.closest("[data-drag-id]");
    if(row) e.dataTransfer.setData("text/plain", row.dataset.dragId);
  });
  grid.addEventListener("dragover", e => {
    const card = e.target.closest("[data-quad]");
    if(card){ e.preventDefault(); card.style.outline = "2px dashed var(--accent)"; }
  });
  grid.addEventListener("dragleave", e => {
    const card = e.target.closest("[data-quad]");
    if(card) card.style.outline = "";
  });
  grid.addEventListener("drop", e => {
    const card = e.target.closest("[data-quad]");
    if(!card) return;
    e.preventDefault(); card.style.outline = "";
    const id = e.dataTransfer.getData("text/plain");
    const t = todos.find(id);
    if(!t) return;
    const key = card.dataset.quad;
    const imp = key[0] === "i", urg = key[1] === "u";
    const prio = imp && urg ? "high" : imp ? "mid" : "low";
    todos.update(id, {important: imp, urgent: urg, prio});
    WB.ui.toast("已移至「" + (imp ? "重要" : "不重要") + (urg ? "紧急" : "不紧急") + "」，优先级→" + PRIO[prio].label);
    WB.router.render();
  });
}

/* ---------- 模块注册 ---------- */
WB.registerModule({
  id: "todos",
  title: "待办事项",
  icon: "check-circle",
  sub: () => {
    const today = WB.bizDate();
    const n = todos.all().filter(t => !t.done && t.date === today).length;
    return n ? "今天还有 " + n + " 件" : "今天清清爽爽";
  },

  render(view){
    materializeRepeats();
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    const seg = el("div", {class: "seg"});
    [["today", "今天"], ["later", "以后"], ["done", "已完成"]].forEach(([v, l]) => {
      seg.appendChild(el("button", {class: viewState.filter === v ? "on" : "", text: l,
        onclick: () => { viewState.filter = v; WB.router.render(); }}));
    });
    bar.appendChild(seg);
    const seg2 = el("div", {class: "seg"});
    [["list", "列表"], ["quad", "四象限"]].forEach(([v, l]) => {
      seg2.appendChild(el("button", {class: viewState.mode === v ? "on" : "", text: l,
        onclick: () => { viewState.mode = v; WB.router.render(); }}));
    });
    bar.appendChild(seg2);
    bar.appendChild(el("button", {class: "btn sm", html: icon("folder", 14) + "<span>清单</span>", onclick: listManager}));

    /* 清单筛选 chips */
    if(allLists().length){
      const chips = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap"}});
      chips.appendChild(el("button", {class: "chip clickable" + (viewState.listId === "" ? "" : " plain"), text: "全部清单",
        onclick: () => { viewState.listId = ""; WB.router.render(); }}));
      allLists().forEach(l => {
        chips.appendChild(el("button", {class: "chip clickable" + (viewState.listId === l.id ? "" : " plain"),
          html: "<span style='width:8px;height:8px;border-radius:50%;background:" + l.color + "'></span>" + l.name,
          onclick: () => { viewState.listId = l.id; WB.router.render(); }}));
      });
      bar.appendChild(chips);
    }
    bar.appendChild(el("span", {class: "grow"}));
    /* 搜索：输入时只重绘列表（repaintList），不整页重建 —— 否则每敲一个字输入框都被换掉、焦点丢失 */
    const search = el("input", {class: "input", placeholder: "搜索待办…", style: {flex: "1 1 170px", minWidth: "140px"}});
    search.value = viewState.q;
    search.addEventListener("input", WB.debounce(() => { viewState.q = search.value.trim(); if(repaintList) repaintList(); }, 200));
    bar.appendChild(search);
    bar.appendChild(el("button", {class: "btn sm" + (viewState.bulk ? " primary" : ""),
      text: viewState.bulk ? "退出多选" : "多选",
      onclick: () => { viewState.bulk = !viewState.bulk; viewState.sel.clear(); WB.router.render(); }}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>新任务（T）</span>",
      onclick: () => todoModal(null)}));
    view.appendChild(bar);

    /* 批量操作条：只在多选模式出现。删除走回收站，撤销条一次可整批还原 */
    if(viewState.bulk){
      const ops = el("div", {class: "row", style: {marginBottom: "12px", flexWrap: "wrap", gap: "8px"}});
      selCountNode = el("span", {class: "small muted", text: "已选 " + viewState.sel.size + " 项"});
      ops.appendChild(selCountNode);
      const withPicked = fn => () => {
        const ids = Array.from(viewState.sel);
        if(!ids.length){ WB.ui.toast("先点几条吧", "warn"); return; }
        fn(ids);
        viewState.sel.clear();
        WB.router.render();
      };
      ops.appendChild(el("button", {class: "btn sm", text: "标记完成", onclick: withPicked(ids => {
        ids.forEach(id => todos.update(id, {done: true, doneAt: Date.now()}));
      })}));
      ops.appendChild(el("button", {class: "btn sm", text: "改到明天", onclick: withPicked(ids => {
        ids.forEach(id => todos.update(id, {date: WB.addDaysStr(WB.bizDate(), 1)}));
      })}));
      ops.appendChild(el("button", {class: "btn sm danger", text: "删除", onclick: withPicked(ids => {
        todos.removeMany(ids);
      })}));
      view.appendChild(ops);
    }

    const content = el("div");
    view.appendChild(content);
    const paint = () => {
      content.innerHTML = "";
      if(viewState.mode === "quad"){ quadrantView(content); return; }
      let arr = todos.all();
      if(viewState.listId) arr = arr.filter(t => t.listId === viewState.listId);
      if(viewState.q){
        const k = viewState.q.toLowerCase();
        arr = arr.filter(t => (t.title || "").toLowerCase().includes(k) || (t.note || "").toLowerCase().includes(k));
      }
      listViewWith(content, arr);
    };
    repaintList = paint;
    paint();
  },

  quickAdd(preset){
    todoModal(null, typeof preset === "object" ? preset : undefined);
  },
});

function listViewWith(content, prefiltered){
  const today = WB.bizDate();  let show = prefiltered;
  if(viewState.filter === "today") show = show.filter(t => !t.done && (t.date === today || (t.date && t.date < today)));
  else if(viewState.filter === "later") show = show.filter(t => !t.done && t.date > today);
  else show = show.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  if(!show.length){
    content.appendChild(el("div", {class: "card"}, WB.ui.emptyState("check-circle",
      viewState.filter === "done" ? "还没有完成的任务" : "干干净净",
      viewState.filter === "done" ? "完成一件来这里看看足迹" : "按 T 快速添加一件今天要做的事")));
    return;
  }
  if(viewState.filter === "done"){
    const card = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("archive", 18) + "<span>已完成（折叠区）</span>"}),
      el("button", {class: "btn sm", style: {marginBottom: "8px"}, text: "一键清理（进回收站）",
        onclick: () => {
          // 按钮文案已写明去向，删完由撤销条兜底（一次可整批还原）
          todos.removeMany(show.map(t => t.id));
          WB.router.render();
        }}));
    const list = el("div", {class: "list"});
    /* 以前硬切 60 条且不说一声：完成超过 60 件后，更早的记录在界面上凭空消失（数据还在） */
    const LIMIT = 60;
    (viewState.showAllDone ? show : show.slice(0, LIMIT)).forEach(t => list.appendChild(todoRow(t)));
    if(show.length > LIMIT){
      list.appendChild(el("div", {class: "row", style: {padding: "10px 6px", gap: "10px"}},
        el("span", {class: "small faint",
          text: viewState.showAllDone ? "共 " + show.length + " 条" : "仅显示最近 " + LIMIT + " 条（共 " + show.length + " 条）"}),
        el("span", {class: "grow"}),
        el("button", {class: "btn sm ghost", text: viewState.showAllDone ? "只看最近 " + LIMIT + " 条" : "查看全部",
          onclick: () => { viewState.showAllDone = !viewState.showAllDone; if(repaintList) repaintList(); }})));
    }
    card.appendChild(list);
    content.appendChild(card);
    return;
  }
  const groups = {};
  show.forEach(t => {
    let g;
    if(t.date < today) g = "⚠ 过期未完成";
    else if(t.date === today) g = "今天 · " + WB.fmtDateCN(today, true);
    else g = WB.fmtDateCN(t.date, true) + " · " + WB.relDayLabel(t.date);
    (groups[g] = groups[g] || []).push(t);
  });
  Object.keys(groups).sort((a, b) => (a.includes("过期") ? -1 : a.slice(0, 1).localeCompare(b.slice(0, 1)))).forEach(g => {
    const arr = groups[g];
    const card = el("div", {class: "card", style: {marginBottom: "14px"}},
      el("div", {class: "card-title", html: icon(g.includes("过期") ? "bell" : "check-circle", 18) + "<span>" + esc(g) + "</span><span class='card-sub'>" + arr.length + " 项</span>"}));
    const list = el("div", {class: "list"});
    /* 手动拖拽过的项按 order 排在最前，其余仍按优先级 + 时刻。
       以前拖拽写回的 order 从没被读过 —— 拖完看着生效，一勾选就弹回原序 */
    arr.sort((a, b) => ordOf(a) - ordOf(b)
      || ({high: 0, mid: 1, low: 2})[a.prio || "mid"] - ({high: 0, mid: 1, low: 2})[b.prio || "mid"]
      || (a.time || "99").localeCompare(b.time || "99"));
    arr.forEach(t => list.appendChild(todoRow(t)));
    card.appendChild(list);
    WB.ui.draggable(list, {onReorder: ids => ids.forEach((id, i) => todos.update(id, {order: i}))});
    content.appendChild(card);
  });
}

/* 供总览/命令面板/快捷键/日历调用。
   toggle 是「勾选一条待办」的唯一出口 —— 日历里那个复选框以前直写 update，
   于是重复任务模板在日历里勾 = 直接变已完成、不生成下一期，与待办页行为不一致 */
WB.todos = {quickAdd(preset){ todoModal(null, typeof preset === "object" ? preset : undefined); },
  materializeRepeats, toggle: checkTodo};
})();

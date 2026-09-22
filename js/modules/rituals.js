/* modules/rituals.js —— 晨间规划仪式 / 收工仪式 / 今日三大件 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

/* ---------- 今日三大件 ---------- */
function bigThreeOf(dateStr){ return WB.store.get("bigThree:" + dateStr, []); }
function saveBigThree(dateStr, items){ WB.store.set("bigThree:" + dateStr, items); }

function pickBigThree(dateStr){
  dateStr = dateStr || WB.bizDate();
  const items = bigThreeOf(dateStr).map(x => ({...x}));
  const todosToday = WB.store.get("todos", []).filter(t => !t.done && t.date === dateStr);

  const body = el("div");
  body.appendChild(el("p", {class: "small muted", style: {marginBottom: "10px"},
    text: "最多圈 3 件。今天只要这几点完成，就是好日子。"}));
  const inputRow = el("div", {class: "row", style: {marginBottom: "10px"}});
  const input = el("input", {class: "input grow", placeholder: "直接写一件，或从下面待办里选", id: "b3-input"});
  inputRow.appendChild(input);
  body.appendChild(inputRow);

  const listBox = el("div", {class: "col", style: {gap: "6px"}});
  const renderList = () => {
    listBox.innerHTML = "";
    items.forEach((it, i) => {
      listBox.appendChild(el("div", {class: "row", style: {padding: "8px 12px", background: "var(--card-2)", borderRadius: "12px"}},
        el("span", {class: "chip"}, i + 1 + ""),
        el("span", {class: "grow", text: it.title}),
        el("button", {class: "icon-btn", html: icon("close", 13), onclick: () => { items.splice(i, 1); renderList(); }})));
    });
    if(items.length >= 3) input.placeholder = "最多 3 件啦";
  };
  renderList();
  const add = () => {
    const v = input.value.trim();
    if(!v || items.length >= 3) return;
    items.push({title: v, done: false});
    input.value = ""; renderList(); input.focus();
  };
  input.addEventListener("keydown", e => { if(e.key === "Enter") add(); });

  if(todosToday.length){
    body.appendChild(el("div", {class: "small faint", style: {margin: "6px 0 4px"}, text: "从今日待办选："}));
    const chips = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px"}});
    todosToday.slice(0, 10).forEach(t => {
      chips.appendChild(el("button", {class: "chip clickable plain", text: t.title,
        onclick: () => { if(items.length < 3 && !items.some(x => x.title === t.title)){ items.push({title: t.title, done: false}); renderList(); } }}));
    });
    body.appendChild(chips);
  }
  body.appendChild(listBox);

  WB.ui.modal({title: "圈出今日三大件", icon: "target", content: body,
    actions: [{label: "就这样，开工", primary: true, onClick: () => {
      saveBigThree(dateStr, items);
      WB.router.render();
    }}]});
}

/* ---------- 晨间仪式 ---------- */
function maybeMorning(){
  const today = WB.bizDate();
  if(WB.store.get("morningDone:" + today, false)) return;
  startMorning();
}
function startMorning(){
  const today = WB.bizDate();
  const yesterday = WB.addDaysStr(today, -1);
  const steps = [];

  /* 第 1 步：回顾昨日未完成 */
  const undone = WB.store.get("todos", []).filter(t => !t.done && t.date && t.date <= yesterday && !(t.repeat && t.repeat.type !== "none"));
  const decisions = {}; // id -> 'today' | 'drop'
  undone.forEach(t => decisions[t.id] = "today");

  const body1 = el("div");
  if(undone.length){
    body1.appendChild(el("p", {class: "small muted", style: {marginBottom: "10px"}},
      "昨天有 " + undone.length + " 件没完成。轻装上阵：要的带到今天，不要的放下。"));
    undone.forEach(t => {
      const row = el("div", {class: "row", style: {padding: "8px 0", borderBottom: "1px dashed var(--card-border)"}});
      row.appendChild(el("span", {class: "grow ellipsis", text: t.title}));
      const seg = el("div", {class: "seg"});
      ["today", "drop"].forEach(v => seg.appendChild(el("button", {
        class: decisions[t.id] === v ? "on" : "", text: v === "today" ? "今天做" : "放下",
        onclick: e => { decisions[t.id] = v; seg.querySelectorAll("button").forEach(b => b.classList.remove("on")); e.target.classList.add("on"); },
      })));
      row.appendChild(seg);
      body1.appendChild(row);
    });
  }else{
    body1.appendChild(el("div", {class: "center col", style: {padding: "18px 0", gap: "8px"}},
      el("span", {style: {fontSize: "34px"}, text: "✨"}),
      el("div", {text: "昨天干干净净，没有欠账"})));
  }
  steps.push({title: "早上好 · 先看看昨天", icon: "sun", content: body1});

  /* 第 2 步：圈三大件 */
  const items = bigThreeOf(today).filter(x => !x.done);
  const body2 = el("div");
  body2.appendChild(el("p", {class: "small muted", style: {marginBottom: "10px"}},
    items.length ? "已圈了 " + items.length + " 件，可以调整：" : "圈出今天 1~3 件最重要的事（也可以跳过）："));
  const input = el("input", {class: "input", placeholder: "写一件今天必须完成的事，回车添加"});
  const list = el("div", {class: "col", style: {gap: "6px", margin: "10px 0"}});
  const render = () => {
    list.innerHTML = "";
    items.forEach((it, i) => list.appendChild(el("div", {class: "row", style: {padding: "8px 12px", background: "var(--card-2)", borderRadius: "12px"}},
      el("span", {class: "chip"}, (i + 1) + ""), el("span", {class: "grow", text: it.title}),
      el("button", {class: "icon-btn", html: icon("close", 13), onclick: () => { items.splice(i, 1); render(); }}))));
  };
  input.addEventListener("keydown", e => {
    if(e.key === "Enter" && input.value.trim() && items.length < 3){
      items.push({title: input.value.trim(), done: false}); input.value = ""; render();
    }
  });
  render();
  body2.appendChild(input); body2.appendChild(list);
  steps.push({title: "今天最重要的三件事", icon: "target", content: body2});

  /* 保存第 i 步的改动（「下一步」与「跳过」共用）：
     以前只有「下一步」保存，点「跳过」越过第一步时，昨天待办的「今天做/放下」全都会丢 */
  const saveStep = i => {
    if(i === 0){
      undone.forEach(t => {
        if(decisions[t.id] === "today") WB.collection("todos").update(t.id, {date: WB.bizDate()});
        else if(decisions[t.id] === "drop") WB.collection("todos").update(t.id, {done: true, doneAt: Date.now(), dropped: true});
      });
    }
    if(i === 1) saveBigThree(today, items);
  };
  /* 顺序播放 */
  let idx = 0;
  let m;
  const show = () => {
    const s = steps[idx];
    const isLast = idx === steps.length - 1;
    m.body.innerHTML = "";
    m.body.appendChild(s.content);
    m.el.querySelector("h3").textContent = s.title;
    const foot = m.el.querySelector(".modal-foot");
    foot.innerHTML = "";
    if(idx > 0) foot.appendChild(el("button", {class: "btn", text: "上一步", onclick: () => { idx--; show(); }}));
    foot.appendChild(el("button", {class: "btn" + (isLast ? " primary" : ""), text: isLast ? "正式开工 ✦" : "下一步",
      onclick: () => {
        saveStep(idx);
        if(isLast){
          WB.store.set("morningDone:" + today, true);
          m.close();
          WB.ui.chime("done");
          WB.router.go("today");
          WB.ui.toast("开工大吉，今天也要好好过 ✦");
        }else{ idx++; show(); }
      }}));
    if(!isLast){
      foot.appendChild(el("button", {class: "btn ghost", text: "跳过", onclick: () => {
        saveStep(idx);
        idx = steps.length - 1; show();
      }}));
    }
  };
  m = WB.ui.modal({title: steps[0].title, icon: "sun", content: steps[0].content, wide: true, onClose: () => {
    WB.store.set("morningDone:" + today, true); // 关闭也算完成，不反复弹
  }});
  show();
}

/* ---------- 收工仪式 ---------- */
function startOffwork(){
  const today = WB.bizDate();
  const undone = WB.store.get("todos", []).filter(t => !t.done && t.date === today);
  const done = WB.store.get("todos", []).filter(t => t.done && t.date === today);
  const moves = {}; // id -> 'tomorrow' | 'drop' | 'keep'
  undone.forEach(t => moves[t.id] = "tomorrow");

  const body = el("div");
  body.appendChild(el("p", {class: "small muted", style: {marginBottom: "10px"}},
    "今天完成了 " + done.length + " 件。" + (undone.length ? "剩下 " + undone.length + " 件，逐个安排：" : "全部清空，漂亮！")));
  undone.forEach(t => {
    const seg = el("div", {class: "seg"});
    ["tomorrow", "drop", "keep"].forEach(v => seg.appendChild(el("button", {
      class: moves[t.id] === v ? "on" : "",
      text: v === "tomorrow" ? "明天" : v === "drop" ? "放弃" : "留着",
      onclick: e => { moves[t.id] = v; seg.querySelectorAll("button").forEach(b => b.classList.remove("on")); e.target.classList.add("on"); },
    })));
    body.appendChild(el("div", {class: "row", style: {padding: "8px 0", borderBottom: "1px dashed var(--card-border)"}},
      el("span", {class: "grow ellipsis", text: t.title}), seg));
  });
  const goJournal = Object.assign(el("input", {type: "checkbox"}), {checked: true});
  body.appendChild(el("label", {class: "row", style: {marginTop: "14px", gap: "10px"}}, goJournal,
    el("span", {text: "收工前写几句今日日志"})));

  WB.ui.modal({
    title: "收工仪式", icon: "moon", content: body, wide: true,
    actions: [{label: "收工，晚安 ✦", primary: true, onClick: () => {
      undone.forEach(t => {
        if(moves[t.id] === "tomorrow") WB.collection("todos").update(t.id, {date: WB.addDaysStr(today, 1)});
        else if(moves[t.id] === "drop") WB.collection("todos").update(t.id, {done: true, doneAt: Date.now(), dropped: true});
      });
      WB.store.set("offworkDone:" + today, true);
      WB.bus.emit("ritual:offwork"); // 声音面板自动静音
      // 内容卡片淡出 + 晚安庆祝
      WB.router.go("today");
      setTimeout(() => {
        WB.ui.celebrate({big: true});
        WB.ui.chime("big");
        const q = WB.data.quoteOf(today);
        WB.ui.toast("晚安 · " + q[0]);
      }, 400);
      if(goJournal.checked) setTimeout(() => WB.journal.editor(today), 900);
    }}],
  });
}

WB.registerModule({
  id: "rituals-internal", title: "仪式", icon: "sun", hidden: true,
  render(){},
});
WB.rituals = {maybeMorning, startMorning, startOffwork, pickBigThree, bigThreeOf};
})();

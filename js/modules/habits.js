/* modules/habits.js —— 习惯打卡：打勾型 / 次数型，连续天数（不可补卡），进度环 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const habits = WB.collection("habits");
const logs = WB.collection("habitLogs");

function logOf(habitId, date){
  return logs.all().find(l => l.habitId === habitId && l.date === date) || null;
}
function setLog(habitId, date, count){
  const ex = logOf(habitId, date);
  if(ex) logs.update(ex.id, {count});
  else logs.add({habitId, date, count});
}
function isDone(h, log){
  if(!log) return false;
  return h.type === "count" ? log.count >= (h.target || 1) : log.count > 0;
}
/* 连续天数：从今天（或昨天，若今天未打）往前数，中断归零；不可补卡 */
function streakOf(habitId){
  let d = WB.bizDate();
  const h = habits.find(habitId);
  if(!h || !isDone(h, logOf(habitId, d))) d = WB.addDaysStr(d, -1); // 今天没打不算断
  let n = 0;
  for(let i = 0; i < 999; i++){
    if(isDone(h, logOf(habitId, d))){ n++; d = WB.addDaysStr(d, -1); }
    else break;
  }
  return n;
}
function totalOf(habitId){
  return logs.all().filter(l => l.habitId === habitId).reduce((s, l) => s + (l.count || 0), 0);
}

/* 今日第一次打卡更隆重 */
function firstToday(){
  const today = WB.bizDate();
  return !WB.store.get("habitLogs", []).some(l => l.date === today && l.count > 0);
}
function habitModal(existing){
  const isNew = !existing;
  const h = Object.assign({name: "", type: "check", target: 8}, existing || {});
  const body = el("div");
  const name = el("input", {class: "input", value: h.name, placeholder: "习惯名，如：喝水 / 阅读 / 早睡"});
  const typeSeg = el("div", {class: "seg"});
  let curType = h.type;
  [["check", "打勾型"], ["count", "次数型"]].forEach(([v, l]) => typeSeg.appendChild(el("button", {
    class: v === curType ? "on" : "", text: l, dataset: {v},
    onclick: () => { curType = v; typeSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); },
  })));
  const targetIn = el("input", {type: "number", class: "input", value: h.target, min: 2, max: 99,
    style: {width: "90px"}});
  const targetField = el("div", {class: "field"}, el("label", {text: "每日目标次数"}), targetIn);
  const syncTarget = () => { targetField.style.display = curType === "count" ? "" : "none"; };
  typeSeg.addEventListener("click", () => setTimeout(syncTarget, 0));
  syncTarget();
  body.appendChild(el("div", {class: "field"}, el("label", {text: "名称"}), name));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "类型"}), typeSeg));
  body.appendChild(targetField);

  WB.ui.modal({
    title: isNew ? "新习惯" : "编辑习惯", icon: "flame", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        WB.ui.confirmBox("删除习惯「" + esc(h.name) + "」？历史记录一并删除（可在回收站恢复习惯本身）。", {danger: true, okLabel: "删除"}).then(ok => {
          if(ok){ habits.remove(h.id); m.close(); WB.router.render(); }
        });
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const nameV = name.value.trim();
        if(!nameV){ name.focus(); return; }
        const patch = {name: nameV, type: curType, target: Math.max(2, parseInt(targetIn.value) || 8)};
        if(isNew) habits.add(patch);
        else habits.update(h.id, patch);
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => name.focus(), 60);
}

function checkRow(h, dateStr, big){
  const log = logOf(h.id, dateStr);
  const done = isDone(h, log);
  const count = log ? log.count : 0;
  const target = h.target || 1;

  const wrap = el("div", {class: "list-row"});
  if(h.type === "check"){
    wrap.appendChild(el("button", {
      html: icon(done ? "check-circle" : "circle", big ? 24 : 21),
      style: {color: done ? "var(--ok)" : "var(--accent)", display: "flex",
        transform: done ? "scale(1.05)" : "none"},
      onclick: e => {
        const wasFirst = firstToday();
        setLog(h.id, dateStr, done ? 0 : 1);
        if(!done){
          WB.ui.starBurst(e.clientX, e.clientY); WB.ui.chime("done");
          if(wasFirst){ WB.ui.celebrate({}); WB.ui.toast("今天第一次打卡，开个好头 ✨"); }
          const s = streakOf(h.id);
          if(s > 0 && s % 7 === 0) WB.ui.toast("🔥「" + h.name + "」连续 " + s + " 天！");
        }
        WB.router.render();
      },
    }));
  }else{
    const pct = Math.min(100, Math.round(count / target * 100));
    wrap.appendChild(WB.ui.ring(pct, 40, 4, count + ""));
    const btns = el("div", {class: "row", style: {gap: "4px"}});
    btns.appendChild(el("button", {class: "btn sm", text: "＋1",
      onclick: e => {
        setLog(h.id, dateStr, count + 1);
        if(count + 1 >= target){ WB.ui.starBurst(e.clientX, e.clientY); WB.ui.chime("done"); WB.ui.toast("「" + h.name + "」今日达标 ✓"); }
        WB.router.render();
      }}));
    if(count > 0) btns.appendChild(el("button", {class: "btn sm ghost", text: "－1",
      onclick: () => { setLog(h.id, dateStr, count - 1); WB.router.render(); }}));
    wrap.appendChild(btns);
  }
  return wrap;
}

WB.registerModule({
  id: "habits",
  title: "习惯打卡",
  icon: "flame",
  sub: () => {
    const today = WB.bizDate();
    const hs = habits.all().filter(h => !h.archived);
    const done = hs.filter(h => isDone(h, logOf(h.id, today))).length;
    return hs.length ? done + "/" + hs.length + " 已完成" : "积少成多";
  },

  render(view){
    const dateStr = WB.bizDate();
    const hs = habits.all().filter(h => !h.archived);

    const head = el("div", {class: "row", style: {marginBottom: "14px"}});
    head.appendChild(el("div", {class: "muted small"}, "中断归零、不可补卡——今天这一下最重要。"));
    head.appendChild(el("span", {class: "grow"}));
    head.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>新习惯</span>",
      onclick: () => habitModal(null)}));
    view.appendChild(head);

    if(!hs.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("sprout", "种下第一个习惯",
        "建议从「小到不可能失败」开始：喝一杯水、读一页书。<br>打勾型每天一次，次数型可设每日目标（如喝水 ×8）。")));
      return;
    }

    const card = el("div", {class: "card"});
    const list = el("div", {class: "list"});
    hs.forEach(h => {
      const row = el("div", {class: "list-row", style: {alignItems: "center", flexWrap: "wrap"}});
      row.appendChild(checkRow(h, dateStr, true));
      const mid = el("div", {class: "grow", style: {minWidth: "140px"}});
      mid.appendChild(el("div", {class: "row", style: {gap: "8px"}},
        el("b", {text: h.name}),
        el("span", {class: "chip plain", text: h.type === "count" ? "×" + (h.target || 1) + "/日" : "每日"})));
      const stats = el("div", {class: "row small muted", style: {gap: "12px", marginTop: "2px"}});
      const st = streakOf(h.id);
      stats.appendChild(el("span", {}, "🔥 连续 ",
        el("b", {style: {color: "var(--accent)"}, text: String(st)}), " 天"));
      stats.appendChild(el("span", {}, "累计 ",
        el("b", {text: String(totalOf(h.id))}), " 次"));
      mid.appendChild(stats);
      row.appendChild(mid);
      if(h.type === "count"){
        const log = logOf(h.id, dateStr);
        row.appendChild(WB.ui.ring(Math.min(100, ((log ? log.count : 0) / (h.target || 1)) * 100), 46, 5,
          (log ? log.count : 0) + "/" + (h.target || 1)));
      }
      row.appendChild(el("button", {class: "icon-btn", html: icon("edit", 15), onclick: () => habitModal(h)}));
      list.appendChild(row);
    });
    card.appendChild(list);
    view.appendChild(card);

    /* 近 14 天迷你热区 */
    const heat = el("div", {class: "card", style: {marginTop: "14px"}});
    heat.appendChild(el("div", {class: "card-title", html: icon("grid", 18) + "<span>近两周</span><span class='card-sub'>颜色深浅 = 完成度</span>"}));
    const grid = el("div", {style: {display: "grid", gridAutoFlow: "column", gridTemplateRows: "repeat(" + Math.min(hs.length, 8) + ", 18px)", gap: "3px", overflowX: "auto", paddingBottom: "4px"}});
    for(let i = 13; i >= 0; i--){
      const d = WB.addDaysStr(dateStr, -i);
      hs.slice(0, 8).forEach(h => {
        const lg = logOf(h.id, d);
        const p = h.type === "count" ? Math.min(1, (lg ? lg.count : 0) / (h.target || 1)) : (lg && lg.count > 0 ? 1 : 0);
        grid.appendChild(el("div", {title: h.name + " · " + d,
          style: {borderRadius: "4px", background: p ? WB.hexToRgba("#7fa3bd", .25 + p * .65) : "var(--card-2)",
            border: "1px solid var(--card-border)"}}));
      });
    }
    heat.appendChild(grid);
    view.appendChild(heat);
  },
});

/* 供总览/统计调用 */
WB.habits = {streakOf, totalOf, isDone, logOf, quickCheck(h, ev){
  const dateStr = WB.bizDate();
  const log = logOf(h.id, dateStr);
  if(h.type === "check"){
    const done = isDone(h, log);
    const wasFirst = firstToday();
    setLog(h.id, dateStr, done ? 0 : 1);
    if(!done){
      if(ev) WB.ui.starBurst(ev.clientX, ev.clientY);
      WB.ui.chime("done");
      if(wasFirst) WB.ui.celebrate({});
    }
    WB.router.render();
  }else{
    WB.router.go("habits");
  }
}};
})();

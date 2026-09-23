/* modules/calendar.js —— 月视图日历（聚合待办/心情/打卡/日志）+ 日视图时间轴（拖任务上时间块） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

WB.registerModule({
  id: "calendar",
  title: "日历",
  icon: "calendar",
  sub: function(){ const d = WB.bizDate(); return WB.fmtDateCN(d, true) + " · 点击任意天看详情"; },

  render(view){
    const todos = WB.collection("todos");
    let ym = WB.monthStr(new Date());
    let selected = WB.bizDate();

    /* ===== 工具条 ===== */
    const bar = el("div", {class: "row", style: {marginBottom: "12px", flexWrap: "wrap", gap: "8px"}});
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-left", 14), onclick: () => { ym = shift(ym, -1); paint(); }}));
    const ymLabel = el("span", {class: "chip", style: {fontSize: "14px"}});
    bar.appendChild(ymLabel);
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-right", 14), onclick: () => { ym = shift(ym, 1); paint(); }}));
    bar.appendChild(el("button", {class: "btn sm ghost", text: "今天", onclick: () => { ym = WB.monthStr(new Date()); selected = WB.bizDate(); paint(); }}));
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("span", {class: "small faint"},
      "● 待办数　", el("span", {style: {color: "var(--accent)"}, text: "●"}, " 心情"), "　● 打卡环　● 日志角标"));
    view.appendChild(bar);

    /* ===== 月历 ===== */
    const calCard = el("div", {class: "card", style: {marginBottom: "14px"}});
    const grid = el("div");
    calCard.appendChild(grid);
    view.appendChild(calCard);

    /* ===== 当日详情 ===== */
    const detail = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    view.appendChild(detail);

    function shift(s, n){
      const [y, m] = s.split("-").map(Number);
      return WB.monthStr(new Date(y, m - 1 + n, 1));
    }

    function dayAgg(ds){
      const t = todos.all().filter(x => x.date === ds);
      const mood = WB.store.get("moods", []).find(x => x.date === ds);
      const logs = WB.store.get("habitLogs", []).filter(x => x.date === ds);
      const habits = WB.store.get("habits", []).filter(h => !h.archived);
      let ringPct = 0;
      if(habits.length){
        const done = habits.filter(h => {
          const lg = logs.find(l => l.habitId === h.id);
          return lg && (h.type === "count" ? lg.count >= (h.target || 1) : lg.count > 0);
        }).length;
        ringPct = done / habits.length;
      }
      const journal = WB.store.get("journals", []).find(x => x.date === ds);
      return {todoCount: t.length, undone: t.filter(x => !x.done).length, mood, ringPct, journal};
    }

    function paint(){
      ymLabel.textContent = ym.replace("-", " 年 ") + " 月";
      grid.innerHTML = "";
      const wd = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "6px", marginBottom: "6px"}});
      ["日", "一", "二", "三", "四", "五", "六"].forEach(w => wd.appendChild(el("div", {class: "center small faint", text: w})));
      grid.appendChild(wd);
      const [y, m] = ym.split("-").map(Number);
      const first = new Date(y, m - 1, 1);
      const days = new Date(y, m, 0).getDate();
      const box = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "6px"}});
      for(let i = 0; i < first.getDay(); i++) box.appendChild(el("div"));
      for(let d = 1; d <= days; d++){
        const ds = ym + "-" + String(d).padStart(2, "0");
        const agg = dayAgg(ds);
        const hol = WB.cal.holidayOf(ds);
        const fest = WB.cal.festivalOf(ds);
        const isToday = ds === WB.bizDate();
        const cell = el("div", {
          style: {borderRadius: "14px", padding: "7px 8px", cursor: "pointer", minHeight: "64px",
            background: selected === ds ? "var(--accent-soft)" : "var(--card-2)",
            border: selected === ds ? "1.5px solid var(--accent)" : "1px solid var(--card-border)",
            outline: isToday && selected !== ds ? "1.5px solid var(--accent-2)" : "none",
            transition: "all .2s", position: "relative", overflow: "hidden"},
          onclick: () => { selected = ds; paint(); },
        });
        /* 日期行 */
        const headRow = el("div", {class: "row", style: {gap: "4px"}});
        headRow.appendChild(el("b", {style: {fontSize: "14px"}, text: String(d)}));
        if(hol) headRow.appendChild(el("span", {class: "small", style: {color: hol.type === "休" ? "var(--ok)" : "var(--danger)", fontSize: "10.5px"}, text: hol.type}));
        if(fest && !hol) headRow.appendChild(el("span", {class: "small", style: {color: "var(--accent)", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}, text: fest}));
        cell.appendChild(headRow);
        /* 聚合行 */
        const dots = el("div", {class: "row", style: {gap: "4px", marginTop: "4px", flexWrap: "wrap"}});
        if(agg.todoCount) dots.appendChild(el("span", {class: "small", style: {fontSize: "10px", background: agg.undone ? "var(--accent-soft)" : "var(--card)", borderRadius: "8px", padding: "0 6px", color: "var(--accent-ink)"}, text: agg.undone ? agg.undone + " 项" : "✓"}));
        if(agg.mood) dots.appendChild(el("span", {style: {width: "9px", height: "9px", borderRadius: "50%", background: ["#c97b6e", "#d49a6e", "#c9bd6f", "#8fbf9f", "#7fa3d1"][agg.mood.level - 1], display: "inline-block"}}));
        if(agg.ringPct > 0){
          const ring = WB.ui.ring(Math.round(agg.ringPct * 100), 18, 3, "");
          dots.appendChild(ring);
        }
        if(agg.journal) dots.appendChild(el("span", {html: icon("book", 11), style: {display: "flex", color: "var(--ink-3)"}}));
        cell.appendChild(dots);
        box.appendChild(cell);
      }
      grid.appendChild(box);
      paintDetail();
    }

    function paintDetail(){
      detail.innerHTML = "";
      const ds = selected;
      const agg = dayAgg(ds);

      /* 左：当日概览 */
      const left = el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("calendar", 18) + "<span>" + WB.fmtDateCN(ds, true) + "</span>",
          onclick: () => WB.router.go("journal", ds)}));
      (WB.cal.festivalOf(ds) ? left.appendChild(el("div", {class: "chip", style: {marginBottom: "8px"}, text: WB.cal.festivalOf(ds)})) : null);
      const t = todos.all().filter(x => x.date === ds);
      const tbox = el("div", {class: "col", style: {gap: "6px"}});
      if(!t.length) tbox.appendChild(el("div", {class: "small faint", text: "无待办"}));
      t.forEach(x => tbox.appendChild(el("label", {class: "row small", style: {gap: "8px"}},
        Object.assign(el("input", {type: "checkbox"}), {checked: !!x.done,
          /* 走 WB.todos.toggle（待办页同一条路径）：重复任务模板会「生成下一期、模板保持未完成」，
             以前这里直写 update，日历勾一下模板就变已完成且不生成下一期 —— 两页行为不一致。
             toggle 内部会广播 view:dirty，整页重建，所以这里不用再调 paint() */
          onchange: () => { if(WB.todos && WB.todos.toggle) WB.todos.toggle(x); }}),
        el("span", {text: x.title, style: x.done ? {textDecoration: "line-through", color: "var(--ink-3)"} : {}}),
        x.time ? el("span", {class: "faint", text: x.time}) : null)));
      left.appendChild(tbox);
      if(agg.mood) left.appendChild(el("div", {class: "row small", style: {marginTop: "10px"}},
        el("span", {class: "faint"}, "心情："),
        el("span", {text: ["😞", "🙁", "😐", "🙂", "😄"][agg.mood.level - 1]}),
        agg.mood.note ? el("span", {class: "faint", text: "「" + agg.mood.note + "」"}) : null));
      if(agg.journal) left.appendChild(el("div", {class: "small muted", style: {marginTop: "10px", cursor: "pointer"},
        onclick: () => WB.router.go("journal", ds),
        text: "📝 " + ((agg.journal.free || agg.journal.done || "已写日志").replace(/[#*`>\[\]]/g, "").slice(0, 50))}));
      left.appendChild(el("div", {class: "row", style: {marginTop: "12px", gap: "8px"}},
        el("button", {class: "btn sm", text: "写日志", onclick: () => WB.router.go("journal", ds)}),
        el("button", {class: "btn sm", text: "添加待办", onclick: () => WB.todos && WB.todos.quickAdd({date: ds})})));
      detail.appendChild(left);

      /* 右：时间轴 */
      detail.appendChild(timelineCard(ds));
    }

    function timelineCard(ds){
      const card = el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("clock", 18) + "<span>时间轴</span><span class='card-sub'>把待办拖到时间段（6:00–24:00，可滚动）</span>"}));
      const withTime = todos.all().filter(x => x.date === ds && x.time && !x.done);
      const unscheduled = todos.all().filter(x => x.date === ds && !x.time && !x.done);

      if(unscheduled.length){
        card.appendChild(el("div", {class: "small muted", style: {marginBottom: "6px"}, text: "未安排时间的待办（拖到右侧时间轴）："}));
        const chipRow = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px", marginBottom: "10px"}});
        unscheduled.forEach(x => {
          const chip = el("span", {class: "chip plain", text: x.title, dataset: {dragId: x.id}, draggable: "true",
            style: {cursor: "grab", maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis"}});
          chipRow.appendChild(chip);
        });
        card.appendChild(chipRow);
      }

      const tl = el("div", {style: {maxHeight: "330px", overflowY: "auto", border: "1px solid var(--card-border)", borderRadius: "12px"}});
      for(let h = 6; h <= 24; h++){
        const hm = (h % 24 === 0 ? "24" : String(h).padStart(2, "0")) + ":00";
        const blocks = withTime.filter(x => parseInt(x.time) === h);
        const row = el("div", {dataset: {hour: h}, style: {display: "flex", borderBottom: "1px dashed var(--card-border)", minHeight: "34px",
          background: blocks.length ? "var(--accent-soft)" : "transparent", transition: "background .2s"}});
        row.appendChild(el("div", {class: "small faint", style: {width: "52px", flex: "none", padding: "7px 8px", textAlign: "right", borderRight: "1px solid var(--card-border)"}, text: hm}));
        const zone = el("div", {class: "grow", style: {padding: "3px 8px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center"}});
        blocks.forEach(x => {
          zone.appendChild(el("span", {class: "chip clickable", text: "⏰ " + x.time.slice(0, 2) + " " + x.title,
            title: "点击取消时间", style: {maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis"},
            onclick: () => { todos.update(x.id, {time: ""}); paint(); }}));
        });
        row.appendChild(zone);
        /* 拖放目标 */
        row.addEventListener("dragover", e => { e.preventDefault(); row.style.background = "var(--accent-soft)"; });
        row.addEventListener("dragleave", () => { row.style.background = blocks.length ? "var(--accent-soft)" : "transparent"; });
        row.addEventListener("drop", e => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          if(id && todos.find(id)){
            todos.update(id, {time: String(h % 24).padStart(2, "0") + ":00"});
            WB.ui.toast("已安排到 " + (h % 24) + ":00");
            paint();
          }
        });
        tl.appendChild(row);
      }
      card.appendChild(tl);
      /* 拖拽源 */
      card.addEventListener("dragstart", e => {
        const c = e.target.closest("[data-drag-id]");
        if(c) e.dataTransfer.setData("text/plain", c.dataset.dragId);
      });
      return card;
    }

    paint();
  },
});
})();

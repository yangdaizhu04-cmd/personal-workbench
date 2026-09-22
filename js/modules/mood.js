/* modules/mood.js —— 心情记录：5 档表情 + 备注 + 月历色块 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;
const moods = WB.collection("moods");
const FACES = [["😞", "很糟"], ["🙁", "不太好"], ["😐", "一般"], ["🙂", "不错"], ["😄", "很好"]];
const LEVEL_COLORS = ["#c97b6e", "#d49a6e", "#c9bd6f", "#8fbf9f", "#7fa3d1"];
/* 正在看哪个月：放模块级，点历史格子/记一笔引发的重渲染不再跳回本月；跨天进来才回到本月 */
let ym = "";
let ymDay = "";

WB.registerModule({
  id: "mood",
  title: "心情记录",
  icon: "smile",
  sub: () => "每天一格，看见情绪的形状",

  render(view){
    const today = WB.bizDate();
    const rec = moods.all().find(m => m.date === today);

    /* 今日记录卡 */
    const card = el("div", {class: "card", style: {marginBottom: "14px"}});
    card.appendChild(el("div", {class: "card-title", html: icon("smile", 18) + "<span>今天的心情</span>"}));
    const row = el("div", {class: "row", style: {justifyContent: "space-around", fontSize: "30px", padding: "8px 0 4px"}});
    FACES.forEach(([emoji, label], i) => {
      const level = i + 1;
      row.appendChild(el("button", {
        text: emoji,
        style: {fontSize: rec && rec.level === level ? "44px" : "32px", transition: "all var(--dur) var(--ease-pop)",
          filter: rec && rec.level === level ? "none" : "grayscale(.8)", opacity: rec && rec.level === level ? 1 : .55},
        onclick: () => setMood(today, level, rec && rec.note, true),
        title: label,
      }));
    });
    card.appendChild(row);
    const labels = el("div", {class: "row small faint", style: {justifyContent: "space-around"}});
    FACES.forEach(([, l]) => labels.appendChild(el("span", {text: l})));
    card.appendChild(labels);
    const note = el("textarea", {class: "input", placeholder: "补充一句（可选）…", style: {marginTop: "12px", minHeight: "60px"}});
    note.value = (rec && rec.note) || "";
    const saveBtn = el("button", {class: "btn sm primary", style: {marginTop: "8px"}, text: "保存备注",
      onclick: () => { setMood(today, (rec && rec.level) || 3, note.value.trim(), true); }});
    card.appendChild(note);
    card.appendChild(saveBtn);
    view.appendChild(card);

    /* 月历视图 */
    if(!ym || ymDay !== WB.bizDate()){ ym = WB.monthStr(new Date()); ymDay = WB.bizDate(); }
    const calCard = el("div", {class: "card"});
    const head = el("div", {class: "card-title"},
      el("button", {class: "icon-btn", html: icon("chev-left", 16), "aria-label": "上一个月",
        onclick: () => { ym = shiftMonth(ym, -1); paintCal(); }}),
      el("span", {class: "grow", style: {textAlign: "center"}, id: "mood-ym"}),
      el("button", {class: "icon-btn", html: icon("chev-right", 16), "aria-label": "下一个月",
        onclick: () => { ym = shiftMonth(ym, 1); paintCal(); }}));
    calCard.appendChild(head);
    const grid = el("div", {id: "mood-grid"});
    calCard.appendChild(grid);
    view.appendChild(calCard);

    function shiftMonth(s, n){
      const [y, m] = s.split("-").map(Number);
      const d = new Date(y, m - 1 + n, 1);
      return WB.monthStr(d);
    }
    function paintCal(){
      calCard.querySelector("#mood-ym").textContent = ym.replace("-", " 年 ") + " 月";
      grid.innerHTML = "";
      const wd = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "5px", marginBottom: "6px"}});
      ["日", "一", "二", "三", "四", "五", "六"].forEach(w => wd.appendChild(el("div", {class: "center small faint", text: w})));
      grid.appendChild(wd);
      const [y, m] = ym.split("-").map(Number);
      const first = new Date(y, m - 1, 1);
      const days = new Date(y, m, 0).getDate();
      const box = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "5px"}});
      for(let i = 0; i < first.getDay(); i++) box.appendChild(el("div"));
      for(let d = 1; d <= days; d++){
        const ds = ym + "-" + String(d).padStart(2, "0");
        const r = moods.all().find(x => x.date === ds);
        const cell = el("div", {
          class: "center", text: String(d),
          style: {aspectRatio: "1", borderRadius: "10px", cursor: "pointer", fontSize: "12.5px",
            background: r ? WB.hexToRgba(LEVEL_COLORS[r.level - 1], .8) : "var(--card-2)",
            color: r ? "#fff" : "var(--ink-3)", border: "1px solid var(--card-border)",
            outline: ds === WB.bizDate() ? "2px solid var(--accent)" : "none",
            transition: "transform .2s"},
          title: r ? FACES[r.level - 1][1] + (r.note ? " · " + r.note : "") : ds,
          onclick: () => setMood(ds, (r && r.level) || 3, r && r.note),
        });
        box.appendChild(cell);
      }
      grid.appendChild(box);
    }
    paintCal();
  },
});

function setMood(dateStr, level, note, celebrate){
  const all = moods.all();
  const ex = all.find(m => m.date === dateStr);
  if(ex) moods.update(ex.id, {level, note: note || ""});
  else moods.add({date: dateStr, level, note: note || ""});
  if(celebrate){
    WB.ui.chime("done");
    WB.ui.toast("心情记下了：" + FACES[level - 1][1] + (note ? " · " + note : ""));
  }
  WB.router.render();
}
WB.mood = {setMood};
})();

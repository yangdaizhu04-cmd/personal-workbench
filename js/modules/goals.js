/* modules/goals.js —— 月度目标：3~5 个目标、百分比进度、月初归档重来 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const goals = WB.collection("goals");

function goalModal(existing, month){
  const isNew = !existing;
  const g = Object.assign({title: "", progress: 0, month: month || WB.monthStr(new Date())}, existing || {});
  const body = el("div");
  const title = el("input", {class: "input", value: g.title, placeholder: "这个月想达成什么？"});
  const progress = el("input", {type: "number", class: "input", value: g.progress, min: 0, max: 100, style: {width: "100px"}});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "目标"}), title));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "当前进度（%）"}), progress));
  const m = WB.ui.modal({
    title: isNew ? "新月度目标" : "编辑目标", icon: "trend-up", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        WB.ui.confirmBox("删除目标「" + esc(g.title) + "」？", {danger: true, okLabel: "删除"}).then(ok => {
          if(ok){ goals.remove(g.id); m.close(); WB.router.render(); }
        });
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const tv = title.value.trim();
        if(!tv){ title.focus(); return; }
        const patch = {title: tv, progress: WB.clamp(parseInt(progress.value) || 0, 0, 100)};
        if(isNew) goals.add(Object.assign(patch, {month: g.month}));
        else goals.update(g.id, patch);
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => title.focus(), 60);
}

WB.registerModule({
  id: "goals",
  title: "月度目标",
  icon: "trend-up",
  sub: function(){
    const ym = WB.monthStr(new Date());
    const arr = goals.all().filter(g => g.month === ym);
    if(!arr.length) return "这个月还没立目标";
    const avg = Math.round(arr.reduce((s, g) => s + (g.progress || 0), 0) / arr.length);
    return arr.length + " 个目标 · 平均 " + avg + "%";
  },

  render(view, param){
    let ym = param && /^\d{4}-\d{2}$/.test(param) ? param : WB.monthStr(new Date());
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-left", 14), onclick: () => WB.router.go("goals", shift(ym, -1))}));
    bar.appendChild(el("span", {class: "chip", text: ym.replace("-", " 年 ") + " 月"}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-right", 14), onclick: () => WB.router.go("goals", shift(ym, 1))}));
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>立个目标</span>",
      onclick: () => goalModal(null, ym)}));
    view.appendChild(bar);

    const arr = goals.all().filter(g => g.month === ym).sort((a, b) => a.createdAt - b.createdAt);
    if(!arr.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("target",
        ym === WB.monthStr(new Date()) ? "给这个月立 3~5 个目标" : ym + " 没有目标记录",
        "别贪多：完成了月初归档重来，看得见的进度最养人")));
      return;
    }

    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    arr.forEach(g => {
      const pct = g.progress || 0;
      const card = el("div", {class: "card hoverable"},
        el("div", {class: "row", style: {alignItems: "flex-start"}},
          WB.ui.ring(pct, 56, 5, pct + "%"),
          el("div", {class: "grow", style: {marginLeft: "12px", minWidth: 0}},
            el("div", {style: {fontWeight: "600"}, text: g.title}),
            el("div", {class: "small faint", style: {marginTop: "2px"}},
              pct >= 100 ? "🎉 已达成" : "还差 " + (100 - pct) + "%")),
          el("div", {class: "col", style: {gap: "4px"}},
            el("button", {class: "btn sm", text: "+10", onclick: () => { goals.update(g.id, {progress: Math.min(100, pct + 10)}); WB.router.render(); }}),
            el("button", {class: "btn sm ghost", text: "编辑", onclick: () => goalModal(g)}))));
      grid.appendChild(card);
    });
    view.appendChild(grid);

    const doneCount = arr.filter(g => (g.progress || 0) >= 100).length;
    view.appendChild(el("div", {class: "small faint center", style: {marginTop: "14px"},
      text: doneCount + "/" + arr.length + " 已达成 · 月底归档，下月重新出发"}));
  },
});
function shift(s, n){
  const [y, m] = s.split("-").map(Number);
  return WB.monthStr(new Date(y, m - 1 + n, 1));
}
})();

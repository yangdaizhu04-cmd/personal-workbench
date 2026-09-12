/* modules/wishes.js —— 年度愿望清单：逐条点亮、目标件数、年度报告 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const wishes = WB.collection("wishes");

function wishModal(existing, year){
  const isNew = !existing;
  const w = Object.assign({title: "", year: year || String(new Date().getFullYear())}, existing || {});
  const body = el("div");
  const title = el("input", {class: "input", value: w.title, placeholder: "想完成的事，如：去一次海边"});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "愿望"}), title));
  const m = WB.ui.modal({
    title: isNew ? "新的愿望" : "编辑愿望", icon: "star", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        WB.ui.confirmBox("删除这条愿望？", {danger: true, okLabel: "删除"}).then(ok => {
          if(ok){ wishes.remove(w.id); m.close(); WB.router.render(); }
        });
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const tv = title.value.trim();
        if(!tv){ title.focus(); return; }
        if(isNew) wishes.add({title: tv, year: w.year, done: false});
        else wishes.update(w.id, {title: tv});
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => title.focus(), 60);
}

WB.registerModule({
  id: "wishes",
  title: "年度愿望",
  icon: "star",
  sub: function(){
    const y = String(new Date().getFullYear());
    const arr = wishes.all().filter(w => w.year === y);
    return arr.length ? "已点亮 " + arr.filter(w => w.done).length + "/" + arr.length : "想完成的事都写下来";
  },

  render(view, param){
    const curYear = String(new Date().getFullYear());
    let year = param || curYear;

    /* 年份切换 + 目标件数 */
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    const prev = String(+year - 1), next = String(+year + 1);
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-left", 14), onclick: () => WB.router.go("wishes", prev)}));
    bar.appendChild(el("span", {class: "chip", text: year + " 年" + (year === curYear ? " · 今年" : "")}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-right", 14), onclick: () => WB.router.go("wishes", next)}));
    bar.appendChild(el("span", {class: "grow"}));
    const targetIn = el("input", {type: "number", class: "input", min: 0, placeholder: "目标件数",
      value: WB.store.get("wishTarget:" + year, ""), style: {width: "96px"}});
    targetIn.addEventListener("change", () => WB.store.set("wishTarget:" + year, parseInt(targetIn.value) || 0));
    bar.appendChild(targetIn);
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>许个愿</span>",
      onclick: () => wishModal(null, year)}));
    view.appendChild(bar);

    const arr = wishes.all().filter(w => w.year === year).sort((a, b) =>
      (a.done ? 1 : 0) - (b.done ? 1 : 0) || a.createdAt - b.createdAt);
    const target = WB.store.get("wishTarget:" + year, 0) || 0;
    const doneCount = arr.filter(w => w.done).length;

    /* 进度卡 */
    const head = el("div", {class: "card", style: {marginBottom: "14px"}});
    head.appendChild(el("div", {class: "row"},
      el("div", {class: "grow"},
        el("div", {class: "card-title", html: icon("star", 18) + "<span>点亮进度</span>"}),
        el("div", {class: "small muted", style: {marginBottom: "8px"}},
          "已点亮 " + doneCount + " 件" + (target ? " / 目标 " + target + " 件" : "") +
          (arr.length ? " · 完成率 " + Math.round(doneCount / arr.length * 100) + "%" : ""))),
      el("div", {}, WB.ui.ring(target ? Math.min(100, doneCount / target * 100) : (arr.length ? doneCount / arr.length * 100 : 0), 64, 6,
        target ? doneCount + "/" + target : doneCount + ""))));
    head.appendChild(el("div", {class: "bar"}, el("i", {style: {width: (arr.length ? doneCount / arr.length * 100 : 0) + "%"}})));
    view.appendChild(head);

    if(!arr.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("star", year + " 年，想完成些什么？",
        "数量随缘，也可以设个目标件数（比如 100 件）。<br>完成一件点亮一件，年底生成年度报告。")));
    }else{
      const card = el("div", {class: "card"});
      const list = el("div", {class: "list"});
      arr.forEach(w => {
        const row = el("div", {class: "list-row"},
          el("button", {
            html: icon(w.done ? "star" : "star", 22),
            style: {color: w.done ? "#e8cf8f" : "var(--ink-3)", display: "flex",
              filter: w.done ? "none" : "grayscale(1)", transition: "all .3s"},
            onclick: e => {
              if(!w.done){
                wishes.update(w.id, {done: true, doneAt: Date.now()});
                WB.ui.starBurst(e.clientX, e.clientY);
                WB.ui.chime("done");
                WB.ui.toast("点亮了一颗星 ✨");
                if(WB.badgeCheck) WB.badgeCheck();
              }else{
                wishes.update(w.id, {done: false, doneAt: undefined});
              }
              WB.router.render();
            }}),
          el("span", {class: "grow", text: w.title,
            style: w.done ? {color: "var(--ink-3)"} : {}}),
          w.done && w.doneAt ? el("span", {class: "small faint", text: WB.fmtDateCN(WB.dateStr(new Date(w.doneAt)))}) : null,
          el("button", {class: "icon-btn", html: icon("edit", 14), onclick: () => wishModal(w)}));
        list.appendChild(row);
      });
      card.appendChild(list);
      view.appendChild(card);
    }

    /* 年度报告（往年年份 或 本年且有完成项） */
    if(year !== curYear || (doneCount > 0 && new Date().getMonth() === 11)){
      const months = {};
      arr.filter(w => w.done && w.doneAt).forEach(w => {
        const m = new Date(w.doneAt).getMonth() + 1;
        months[m] = (months[m] || 0) + 1;
      });
      const rep = el("div", {class: "card", style: {marginTop: "14px", background: "linear-gradient(135deg, var(--accent-soft), var(--accent2-soft))"}},
        el("div", {class: "card-title", html: icon("gift", 18) + "<span>" + year + " 年度报告</span>"}),
        el("div", {style: {lineHeight: 2}},
          "这一年你许下 " + arr.length + " 个愿望，点亮了 " + doneCount + " 个 ✨",
          el("br"),
          doneCount ? "最密集的月份是 " + (Object.entries(months).sort((a, b) => b[1] - a[1])[0] || ["-", 0])[0] + " 月" : "明年继续，星星不会缺席"));
      view.appendChild(rep);
    }
  },
});
})();

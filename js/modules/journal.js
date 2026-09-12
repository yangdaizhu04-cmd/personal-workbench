/* modules/journal.js —— 每日日志：三栏模板 + 自由区 + Markdown + #标签 + 今日一问 + 补写历史 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const journals = WB.collection("journals");

function ofDate(dateStr){
  return journals.all().find(j => j.date === dateStr) || null;
}
function saveDate(dateStr, patch){
  const ex = ofDate(dateStr);
  if(ex) journals.update(ex.id, patch);
  else journals.add(Object.assign({date: dateStr}, patch));
}

function editor(dateStr){
  const j = ofDate(dateStr) || {};
  const body = el("div");
  const mk = (label, key, ph, ta) => {
    const input = ta ? el("textarea", {class: "input", placeholder: ph, style: {minHeight: ta}}) : el("input", {class: "input", placeholder: ph});
    input.value = j[key] || "";
    body.appendChild(el("div", {class: "field"}, el("label", {text: label}), input));
    return input;
  };
  const done = mk("今天完成", "done", "完成的事，一行一件…", "70px");
  const prob = mk("遇到问题", "problems", "卡住的地方、情绪、反思…", "70px");
  const plan = mk("明日计划", "plan", "明天最重要的三件事…", "60px");
  const free = mk("自由书写", "free", "支持 Markdown：**加粗**、- 列表、> 引用、[ ] 勾选框、#标签…", "140px");
  const q = WB.data.questionOf(dateStr);
  const answer = el("textarea", {class: "input", placeholder: "想答就写几句，年底会生成问答集锦", style: {minHeight: "70px"}});
  answer.value = j.answer || "";
  body.appendChild(el("div", {class: "card", style: {background: "var(--card-2)", boxShadow: "none", marginBottom: "14px", padding: "12px 14px"}},
    el("div", {class: "row small", html: icon("quote", 15) + "<span style='color:var(--accent)'>今日一问</span>"}),
    el("div", {style: {marginTop: "4px", fontWeight: "600"}, text: q}),
    answer));

  const preview = el("div", {class: "card", style: {background: "var(--card-2)", boxShadow: "none", display: "none", padding: "14px"}});
  const togglePreview = el("button", {class: "btn sm", text: "预览 Markdown",
    onclick: () => {
      if(preview.style.display === "none"){
        preview.innerHTML = WB.md.render(free.value);
        preview.style.display = "block";
        togglePreview.textContent = "编辑";
      }else{
        preview.style.display = "none";
        togglePreview.textContent = "预览 Markdown";
      }
    }});
  body.appendChild(el("div", {class: "row", style: {justifyContent: "flex-end", marginBottom: "8px"}}, togglePreview));
  body.appendChild(preview);

  WB.ui.modal({
    title: "日志 · " + WB.fmtDateCN(dateStr, true), icon: "book", content: body, wide: true,
    actions: [{label: "保存", primary: true, onClick: () => {
      saveDate(dateStr, {
        done: done.value, problems: prob.value, plan: plan.value, free: free.value,
        answer: answer.value,
        tags: [...new Set(WB.md.extractTags((free.value || "") + " " + (done.value || "")))],
        question: q,
      });
      WB.ui.toast("日志已保存");
      WB.router.render();
    }}],
  });
}

WB.registerModule({
  id: "journal",
  title: "每日日志",
  icon: "book",
  sub: () => "完成 · 问题 · 明日计划",

  render(view, param){
    const dateStr = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : WB.bizDate();
    const j = ofDate(dateStr);

    /* 顶部：日期切换 */
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-left", 14),
      onclick: () => WB.router.go("journal", WB.addDaysStr(dateStr, -1))}));
    bar.appendChild(el("span", {class: "chip", text: WB.fmtDateCN(dateStr, true) + (dateStr === WB.bizDate() ? " · 今天" : "")}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-right", 14),
      onclick: () => WB.router.go("journal", WB.addDaysStr(dateStr, 1))}));
    const dateIn = el("input", {type: "date", class: "input", value: dateStr, style: {width: "150px"}});
    dateIn.addEventListener("change", () => WB.router.go("journal", dateIn.value));
    bar.appendChild(dateIn);
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("edit", 14) + "<span>" + (j ? "编辑" : "开始写") + "</span>",
      onclick: () => editor(dateStr)}));
    view.appendChild(bar);

    /* 摘要行 */
    const todosDone = WB.store.get("todos", []).filter(t => t.date === dateStr && t.done).length;
    const pomo = WB.store.get("pomoLog", []).filter(l => l.date === dateStr && l.status === "done").length;
    const spend = WB.store.get("ledger", []).filter(l => l.date === dateStr && l.type === "out").reduce((s, l) => s + (l.amount || 0), 0);
    view.appendChild(el("div", {class: "row", style: {flexWrap: "wrap", gap: "8px", marginBottom: "14px"}},
      el("span", {class: "chip plain"}, "✅ 完成 " + todosDone + " 项任务"),
      el("span", {class: "chip plain"}, "🍅 专注 " + pomo + " 个番茄"),
      el("span", {class: "chip plain"}, "💸 支出 ¥" + spend.toFixed(2).replace(/\.00$/, ""))));

    if(!j){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("feather", "这一页还是空白",
        "三栏模板 + 自由书写，写几句就好。<br>凌晨 4 点前写的仍算前一天。")));
      return;
    }

    /* 内容渲染 */
    const card = el("div", {class: "card"});
    const sec = (label, text) => text ? [
      el("div", {class: "card-title", style: {margin: "14px 0 6px"}}, el("span", {class: "small", style: {color: "var(--accent)"}, text: label})),
      el("div", {html: WB.md.render(text)}),
    ] : [];
    card.appendChild(el("div", {class: "card-title", html: icon("book", 18) + "<span>日志内容</span>"}));
    sec("今天完成", j.done).forEach(n => card.appendChild(n));
    sec("遇到问题", j.problems).forEach(n => card.appendChild(n));
    sec("明日计划", j.plan).forEach(n => card.appendChild(n));
    sec("自由书写", j.free).forEach(n => card.appendChild(n));
    if(j.answer){
      card.appendChild(el("div", {class: "card-title", style: {margin: "14px 0 6px"}}, el("span", {class: "small", style: {color: "var(--accent)"}, text: "今日一问 · " + (j.question || "")})));
      card.appendChild(el("div", {html: WB.md.render(j.answer)}));
    }
    if(j.tags && j.tags.length){
      card.appendChild(el("div", {class: "row", style: {marginTop: "12px", flexWrap: "wrap"}},
        j.tags.map(t => el("span", {class: "tag", text: "#" + t}))));
    }
    view.appendChild(card);
  },
});
WB.journal = {editor, ofDate};
})();

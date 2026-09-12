/* 13-exports.js —— 数据导出：日志/笔记 Markdown、账单 CSV（JSON 备份在设置页） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

function journals(){
  const js = WB.store.get("journals", []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if(!js.length){ WB.ui.toast("还没有日志可导出", "warn"); return; }
  let md = "# 我的日志\n\n";
  js.forEach(j => {
    md += "\n---\n\n## " + j.date + "\n\n";
    if(j.question) md += "> 今日一问：" + j.question + "\n\n";
    if(j.answer) md += "**答：**" + j.answer + "\n\n";
    if(j.done) md += "### 今天完成\n" + j.done + "\n\n";
    if(j.problems) md += "### 遇到问题\n" + j.problems + "\n\n";
    if(j.plan) md += "### 明日计划\n" + j.plan + "\n\n";
    if(j.free) md += "### 随笔\n" + j.free + "\n\n";
    if(j.tags && j.tags.length) md += "标签：" + j.tags.map(t => "#" + t).join(" ") + "\n";
  });
  WB.downloadFile("日志导出-" + WB.todayStr() + ".md", md, "text/markdown;charset=utf-8");
  WB.ui.toast("已导出 " + js.length + " 篇日志");
}

function notes(){
  const ns = WB.store.get("notes", []).slice().sort((a, b) => a.createdAt - b.createdAt);
  if(!ns.length){ WB.ui.toast("还没有笔记可导出", "warn"); return; }
  let md = "# 我的笔记\n";
  ns.forEach(n => {
    md += "\n---\n\n**" + new Date(n.createdAt).toLocaleString() + "**" +
      (n.tags && n.tags.length ? "  \n" + n.tags.map(t => "#" + t).join(" ") : "") +
      "\n\n" + n.content + "\n";
  });
  WB.downloadFile("笔记导出-" + WB.todayStr() + ".md", md, "text/markdown;charset=utf-8");
  WB.ui.toast("已导出 " + ns.length + " 条笔记");
}

function ledger(){
  const ls = WB.store.get("ledger", []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if(!ls.length){ WB.ui.toast("还没有账单可导出", "warn"); return; }
  const cats = WB.store.get("ledgerCats", []);
  const catName = id => { const c = cats.find(x => x.id === id); return c ? c.name : ""; };
  let csv = "\uFEFF日期,类型,金额,分类,备注\n"; // BOM 让 Excel 正确识别 UTF-8
  ls.forEach(l => {
    const note = '"' + String(l.note || "").replace(/"/g, '""') + '"';
    csv += [l.date, l.type === "out" ? "支出" : "收入", l.amount, catName(l.catId), note].join(",") + "\n";
  });
  WB.downloadFile("账单导出-" + WB.todayStr() + ".csv", csv, "text/csv;charset=utf-8");
  WB.ui.toast("已导出 " + ls.length + " 笔账单");
}

WB.exports = {journals, notes, ledger};
})();

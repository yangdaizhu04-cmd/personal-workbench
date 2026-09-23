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

/* ---- Obsidian 兼容导出：日志/笔记/账单打成 .md 文件夹树的 zip ----
   ZIP 只用 store 模式（不压缩）：文本量不大，省掉引入压缩库 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  let c = 0xFFFFFFFF;
  bytes.forEach(b => { c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); });
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* entries: [{name, data: string}] → Uint8Array（zip） */
function makeZip(entries){
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  entries.forEach(e => {
    const nameB = enc.encode(e.name), dataB = enc.encode(e.data), crc = crc32(dataB);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);      // local file header
    local.setUint32(4, 20, true);              // version
    local.setUint32(8, 0, true);               // store
    local.setUint32(14, crc, true);
    local.setUint32(18, dataB.length, true);
    local.setUint32(22, dataB.length, true);
    local.setUint16(26, nameB.length, true);
    chunks.push(new Uint8Array(local.buffer), nameB, dataB);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);        // central directory
    cen.setUint32(4, 20, true);
    cen.setUint32(8, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, dataB.length, true);
    cen.setUint32(24, dataB.length, true);
    cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + dataB.length;
  });
  let centralSize = 0;
  central.forEach(c => { centralSize += c.length; });
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);          // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  all.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}
function fm(obj){   // YAML frontmatter
  const lines = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => Array.isArray(v) ? k + ": [" + v.join(", ") + "]" : k + ": " + v);
  return "---\n" + lines.join("\n") + "\n---\n\n";
}
function obsidian(){
  const entries = [];
  const js = WB.store.get("journals", []).slice().sort((a, b) => a.date.localeCompare(b.date));
  js.forEach(j => {
    let md = fm({date: j.date, tags: j.tags, type: "journal"});
    md += "# " + j.date + "\n\n";
    if(j.question) md += "> 今日一问：" + j.question + "\n\n";
    if(j.answer) md += "**答：**" + j.answer + "\n\n";
    if(j.done) md += "## 今天完成\n" + j.done + "\n\n";
    if(j.problems) md += "## 遇到问题\n" + j.problems + "\n\n";
    if(j.plan) md += "## 明日计划\n" + j.plan + "\n\n";
    if(j.free) md += "## 随笔\n" + j.free + "\n";
    entries.push({name: "日志/" + j.date + ".md", data: md});
  });
  WB.store.get("notes", []).forEach(n => {
    const d = new Date(n.createdAt || Date.now());
    const slug = WB.dateStr(d) + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
    entries.push({name: "笔记/" + slug + ".md",
      data: fm({created: WB.dateStr(d), tags: n.tags, type: "note"}) + n.content + "\n"});
  });
  const ls = WB.store.get("ledger", []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if(ls.length){
    const cats = WB.store.get("ledgerCats", []);
    const catName = id => { const c = cats.find(x => x.id === id); return c ? c.name : ""; };
    let csv = "日期,类型,金额,分类,备注\n";
    ls.forEach(l => {
      csv += [l.date, l.type === "out" ? "支出" : "收入", l.amount, catName(l.catId), '"' + String(l.note || "").replace(/"/g, '""') + '"'].join(",") + "\n";
    });
    entries.push({name: "账单.csv", data: csv});
  }
  if(!entries.length){ WB.ui.toast("还没有可导出的数据", "warn"); return; }
  const blob = new Blob([makeZip(entries)], {type: "application/zip"});
  WB.downloadFile("Obsidian库-" + WB.todayStr() + ".zip", blob, "application/zip");
  WB.ui.toast("已导出 " + entries.length + " 个文件（zip）");
}
WB.exports.obsidian = obsidian;
WB.makeZip = makeZip;   // 探针/调试用：验证 zip 字节结构
})();

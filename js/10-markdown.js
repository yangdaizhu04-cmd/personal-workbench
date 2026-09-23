/* 10-markdown.js —— 迷你 Markdown（加粗/斜体/行内代码/列表/引用/勾选框/标题/链接，纯本地，先转义防注入） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
/* esc 必须解构出来：本文件的 render() 一直在用它，但从来没引入过 ——
   只要调用 WB.md.render() 就抛 ReferenceError（笔记页有笔记时整页渲染失败）。
   以前没暴露是因为「笔记页 + 有笔记」这条路径平时没人走到（踩坑 #057 的连带发现） */
const { esc } = WB;

function inline(s){
  return s
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function render(src){
  const lines = String(src == null ? "" : src).replace(/\r/g, "").split("\n");
  let html = "", inList = false, inQuote = false;
  const closeAll = () => {
    if(inList){ html += "</ul>"; inList = false; }
    if(inQuote){ html += "</blockquote>"; inQuote = false; }
  };
  for(const raw of lines){
    const line = esc(raw);
    const t = line.trim();
    if(!t){ closeAll(); continue; }
    const h = t.match(/^(#{1,4})\s+(.*)/);
    if(h){
      closeAll();
      const lv = Math.min(4, h[1].length + 2); // h3..h6 尺寸
      html += '<div class="md-h md-h' + lv + '">' + inline(h[2]) + "</div>";
      continue;
    }
    const cb = t.match(/^[-*]\s+\[( |x|X)\]\s+(.*)/);
    if(cb){
      if(!inList){ closeAll(); html += "<ul class=\"md-ul\">"; inList = true; }
      const done = cb[1].toLowerCase() === "x";
      html += '<li class="md-check' + (done ? " done" : "") + '"><span class="md-box"></span><span>' + inline(cb[2]) + "</span></li>";
      continue;
    }
    const li = t.match(/^[-*]\s+(.*)/);
    if(li){
      if(!inList){ closeAll(); html += '<ul class="md-ul">'; inList = true; }
      html += "<li>" + inline(li[1]) + "</li>";
      continue;
    }
    const q = t.match(/^>\s?(.*)/);
    if(q){
      if(!inQuote){ closeAll(); html += '<blockquote class="md-quote">'; inQuote = true; }
      html += "<div>" + inline(q[1]) + "</div>";
      continue;
    }
    closeAll();
    html += '<p class="md-p">' + inline(t) + "</p>";
  }
  closeAll();
  return html;
}

/* 提取 #标签 */
function extractTags(text){
  const m = String(text).match(/#([^\s#，。,\.]+)/g) || [];
  return [...new Set(m.map(s => s.slice(1)))];
}

WB.md = {render, extractTags};
})();

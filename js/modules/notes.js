/* modules/notes.js —— 随手笔记：卡片流 + Markdown + 标签 + 搜索 + 语音速记（Web Speech，联网） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const notes = WB.collection("notes");
let filterTag = "";
let keyword = "";

function noteModal(existing){
  const isNew = !existing;
  const n = Object.assign({content: "", tags: []}, existing || {});
  const body = el("div");
  const ta = el("textarea", {class: "input", placeholder: "想到什么写什么…\n支持 Markdown 与 #标签\n（Ctrl+Enter 保存）", style: {minHeight: "180px"}});
  ta.value = n.content;
  const tagHint = el("div", {class: "row small muted", style: {marginTop: "6px", flexWrap: "wrap"}});

  /* 语音速记 */
  const recBtn = el("button", {class: "btn sm", html: icon("mic", 14) + "<span>语音速记</span>"});
  let recog = null, recOn = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    recBtn.disabled = true;
    recBtn.title = "当前浏览器不支持语音识别（需 Chrome/Edge 且联网）";
  }else{
    recBtn.addEventListener("click", () => {
      if(recOn){ recog && recog.stop(); return; }
      recog = new SR();
      recog.lang = "zh-CN";
      recog.continuous = true;
      recog.interimResults = true;
      let base = ta.value;
      recOn = true;
      recBtn.classList.add("primary");
      recBtn.querySelector("span").textContent = "正在听…点停";
      recog.onresult = e => {
        let final = "", interim = "";
        for(let i = e.resultIndex; i < e.results.length; i++){
          const t = e.results[i][0].transcript;
          if(e.results[i].isFinal) final += t; else interim += t;
        }
        if(final) base = (base ? base + "\n" : "") + final.trim();
        ta.value = base + (interim ? "\n" + interim : "");
      };
      const stop = () => {
        recOn = false;
        recBtn.classList.remove("primary");
        recBtn.querySelector("span").textContent = "语音速记";
      };
      recog.onend = stop;
      recog.onerror = ev => {
        stop();
        WB.ui.toast(ev.error === "not-allowed" ? "麦克风权限被拒绝" : "语音识别暂不可用（需联网），已自动停止", "warn");
      };
      try{ recog.start(); }catch(e){ stop(); WB.ui.toast("语音识别启动失败", "warn"); }
    });
  }

  const syncTags = () => {
    n.tags = WB.md.extractTags(ta.value);
    tagHint.innerHTML = "";
    if(n.tags.length){
      tagHint.appendChild(el("span", {text: "识别到标签："}));
      n.tags.forEach(t => tagHint.appendChild(el("span", {class: "tag", text: "#" + t})));
    }
  };
  ta.addEventListener("input", syncTags);
  ta.addEventListener("keydown", e => {
    if((e.ctrlKey || e.metaKey) && e.key === "Enter") saveBtn.click();
  });
  syncTags();

  body.appendChild(ta);
  body.appendChild(el("div", {class: "row", style: {marginTop: "10px", justifyContent: "space-between"}},
    recBtn, tagHint));

  const m = WB.ui.modal({
    title: isNew ? "随手记" : "编辑笔记", icon: "edit", content: body, wide: true,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        WB.ui.confirmBox("删除这条笔记？", {danger: true, okLabel: "删除"}).then(ok => {
          if(ok){ notes.remove(n.id); m.close(); WB.router.render(); }
        });
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const content = ta.value.trim();
        if(!content){ ta.focus(); return; }
        if(isNew) notes.add({content, tags: WB.md.extractTags(content)});
        else notes.update(n.id, {content, tags: WB.md.extractTags(content)});
        m.close(); WB.router.render();
        if(WB.badgeCheck) WB.badgeCheck();
      }},
    ],
  });
  setTimeout(() => ta.focus(), 60);
}

WB.registerModule({
  id: "notes",
  title: "随手笔记",
  icon: "edit",
  sub: () => notes.all().length + " 条 · 无压力记录",

  render(view){
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    const search = el("input", {class: "input", placeholder: "搜索笔记内容或 #标签…", style: {flex: 1, minWidth: "180px"}});
    search.value = keyword;
    search.addEventListener("input", WB.debounce(() => { keyword = search.value.trim(); paint(); }, 200));
    bar.appendChild(search);
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>新笔记（N）</span>",
      onclick: () => noteModal(null)}));
    view.appendChild(bar);

    const tagBar = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap", marginBottom: "12px"}});
    view.appendChild(tagBar);

    const grid = el("div", {class: "grid grid-3", style: {alignItems: "start"}});
    view.appendChild(grid);

    function paint(){
      /* 标签聚合 */
      const tagCount = {};
      notes.all().forEach(n => (n.tags || []).forEach(t => tagCount[t] = (tagCount[t] || 0) + 1));
      const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
      tagBar.innerHTML = "";
      if(tags.length){
        tagBar.appendChild(el("button", {class: "chip clickable" + (filterTag === "" ? "" : " plain"), text: "全部",
          onclick: () => { filterTag = ""; paint(); }}));
        tags.slice(0, 12).forEach(t => tagBar.appendChild(el("button", {
          class: "chip clickable" + (filterTag === t ? "" : " plain"), text: "#" + t + " " + tagCount[t],
          onclick: () => { filterTag = filterTag === t ? "" : t; paint(); }})));
      }else tagBar.appendChild(el("span", {class: "small faint", text: "写 #标签 会自动归类在这里"}));

      /* 过滤 */
      let arr = notes.all().slice().sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt);
      if(filterTag) arr = arr.filter(n => (n.tags || []).includes(filterTag));
      if(keyword){
        const k = keyword.replace(/^#/, "").toLowerCase();
        arr = arr.filter(n => n.content.toLowerCase().includes(k) || (n.tags || []).some(t => t.toLowerCase().includes(k)));
      }
      grid.innerHTML = "";
      if(!arr.length){
        grid.appendChild(el("div", {class: "card", style: {gridColumn: "1/-1"}},
          WB.ui.emptyState("edit", keyword || filterTag ? "没有匹配的笔记" : "还没有笔记",
            keyword || filterTag ? "换个关键词试试" : "像发朋友圈一样，随手记一句")));
          return;
      }
      arr.forEach(n => {
        const card = el("div", {class: "card hoverable", style: {cursor: "pointer", padding: "16px"},
          onclick: () => noteModal(n)});
        const html = WB.md.render(n.content);
        card.appendChild(el("div", {class: "note-body", html, style: {maxHeight: "200px", overflow: "hidden"}}));
        const foot = el("div", {class: "row", style: {marginTop: "10px", gap: "6px"}});
        (n.tags || []).slice(0, 4).forEach(t => foot.appendChild(el("span", {class: "tag", text: "#" + t})));
        foot.appendChild(el("span", {class: "grow"}));
        foot.appendChild(el("span", {class: "small faint", text: new Date(n.createdAt).toLocaleDateString()}));
        foot.appendChild(el("button", {class: "icon-btn", html: icon("pin", 14),
          style: {color: n.pinned ? "var(--accent)" : "var(--ink-3)"},
          onclick: e => { e.stopPropagation(); notes.update(n.id, {pinned: !n.pinned}); paint(); }}));
        card.appendChild(foot);
        grid.appendChild(card);
      });
    }
    paint();
  },

  quickAdd(){ noteModal(null); },
});

WB.notes = {quickAdd(){ noteModal(null); }};
})();

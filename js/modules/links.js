/* modules/links.js —— 常用链接 & 常用文本：点击直达 / 二维码 / 一键复制 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const links = WB.collection("links");
const texts = WB.collection("texts");

function linkModal(existing){
  const isNew = !existing;
  const l = Object.assign({name: "", url: "https://", note: ""}, existing || {});
  const body = el("div");
  const name = el("input", {class: "input", value: l.name, placeholder: "名称，如：公司邮箱"});
  const url = el("input", {class: "input", value: l.url, placeholder: "https://…"});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "名称"}), name));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "网址"}), url));
  const m = WB.ui.modal({
    title: isNew ? "收藏网址" : "编辑网址", icon: "link", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        // 删完给撤销条兜底（回收站 30 天），不再拦一次确认
        links.remove(l.id); m.close(); WB.router.render();
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const n = name.value.trim(), u = url.value.trim();
        if(!n || !u){ (!n ? name : url).focus(); return; }
        const norm = /^https?:\/\//i.test(u) ? u : "https://" + u;
        if(isNew) links.add({name: n, url: norm});
        else links.update(l.id, {name: n, url: norm});
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => name.focus(), 60);
}

/* 浏览器书签 HTML 导入（Chrome/Edge 导出的 netscape 格式）：递归收集 <a>，按 URL 去重 */
function importBookmarks(){
  const file = el("input", {type: "file", accept: ".html", style: {display: "none"}});
  file.addEventListener("change", async () => {
    const f = file.files[0]; if(!f) return;
    try{
      const doc = new DOMParser().parseFromString(await f.text(), "text/html");
      const items = [];
      const walk = node => {
        [...node.children].forEach(ch => {
          if(ch.tagName === "A"){
            const url = (ch.getAttribute("href") || "").trim();
            if(/^https?:\/\//i.test(url)) items.push({name: (ch.textContent || "").trim().slice(0, 40) || "书签", url});
          }else walk(ch);
        });
      };
      walk(doc.body);
      const exist = new Set(links.all().map(x => x.url));
      const fresh = items.filter(x => !exist.has(x.url));
      if(!fresh.length){ WB.ui.toast("没有可导入的新书签（已按网址去重）", "warn"); return; }
      if(!await WB.ui.confirmBox("发现 " + fresh.length + " 条新书签（共 " + items.length + " 条，重复跳过），导入？")) return;
      fresh.forEach(x => links.add({name: x.name, url: x.url, folder: "书签导入"}));
      WB.ui.toast("已导入 " + fresh.length + " 条书签");
      WB.router.render();
    }catch(err){ WB.ui.toast("导入失败：" + err.message, "warn"); }
  });
  file.click();
}

function textModal(existing){
  const isNew = !existing;
  const t = Object.assign({title: "", content: ""}, existing || {});
  const body = el("div");
  const title = el("input", {class: "input", value: t.title, placeholder: "片段名，如：自我介绍"});
  const content = el("textarea", {class: "input", placeholder: "常用文本内容…", style: {minHeight: "120px"}});
  content.value = t.content;
  body.appendChild(el("div", {class: "field"}, el("label", {text: "名称"}), title));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "内容"}), content));
  const m = WB.ui.modal({
    title: isNew ? "常用文本" : "编辑文本", icon: "feather", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        // 删完给撤销条兜底（回收站 30 天），不再拦一次确认
        texts.remove(t.id); m.close(); WB.router.render();
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const tv = title.value.trim(), cv = content.value;
        if(!tv || !cv.trim()){ (!tv ? title : content).focus(); return; }
        if(isNew) texts.add({title: tv, content: cv});
        else texts.update(t.id, {title: tv, content: cv});
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => title.focus(), 60);
}

function qrModal(link){
  const body = el("div", {class: "center col", style: {gap: "12px"}});
  const box = el("div", {id: "qr-box", style: {padding: "14px", background: "#fff", borderRadius: "14px"}});
  body.appendChild(box);
  body.appendChild(el("div", {class: "small muted", style: {textAlign: "center", wordBreak: "break-all"}, text: link.url}));
  try{
    const qr = qrcode(0, "M");
    qr.addData(link.url);
    qr.make();
    box.innerHTML = qr.createSvgTag({cellSize: 4, margin: 2, scalable: true});
    const svg = box.querySelector("svg");
    if(svg){ svg.style.width = "200px"; svg.style.height = "200px"; }
  }catch(e){
    box.textContent = "二维码生成失败";
  }
  WB.ui.modal({title: "二维码 · " + link.name, icon: "qr", content: body,
    actions: [{label: "关", primary: true}]});
}

WB.registerModule({
  id: "links",
  title: "链接 & 文本",
  icon: "link",
  sub: () => links.all().length + " 个网址 · " + texts.all().length + " 段文本",

  render(view){
    /* 链接区 */
    const lcard = el("div", {class: "card", style: {marginBottom: "14px"}});
    lcard.appendChild(el("div", {class: "card-title", html: icon("link", 18) + "<span>常用链接</span>",
      onclick: () => {}}));
    lcard.querySelector(".card-title").appendChild(el("button", {class: "btn sm primary", style: {marginLeft: "auto"},
      html: icon("plus", 13) + "<span>添加</span>", onclick: () => linkModal(null)}));
    lcard.querySelector(".card-title").appendChild(el("button", {class: "btn sm", style: {marginLeft: "6px"},
      html: icon("upload", 13) + "<span>导入书签</span>", onclick: importBookmarks}));
    if(!links.all().length){
      lcard.appendChild(WB.ui.emptyState("link", "收藏第一个网址", "常用的后台、文档、邮箱…一键直达，还能生成二维码手机打开"));
    }else{
      const grid = el("div", {class: "grid grid-3"});
      links.all().slice().sort((a, b) => a.createdAt - b.createdAt).forEach(l => {
        let host = "";
        try{ host = new URL(l.url).hostname.replace(/^www\./, ""); }catch(e){}
        const cell = el("div", {class: "card hoverable", style: {padding: "14px", cursor: "pointer"},
          onclick: () => { try{ window.open(l.url, "_blank"); }catch(e){} }},
          el("div", {class: "row"},
            el("span", {class: "center", style: {width: "34px", height: "34px", borderRadius: "10px", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: "700", flex: "none"},
              text: l.name.slice(0, 1).toUpperCase()}),
            el("div", {class: "grow", style: {minWidth: 0}},
              el("div", {class: "ellipsis", style: {fontWeight: "600"}, text: l.name}),
              el("div", {class: "small faint ellipsis", text: host}))),
          el("div", {class: "row", style: {marginTop: "8px", justifyContent: "flex-end"}},
            el("button", {class: "icon-btn", html: icon("qr", 15), title: "二维码",
              onclick: e => { e.stopPropagation(); qrModal(l); }}),
            el("button", {class: "icon-btn", html: icon("edit", 14),
              onclick: e => { e.stopPropagation(); linkModal(l); }})));
        grid.appendChild(cell);
      });
      lcard.appendChild(grid);
    }
    view.appendChild(lcard);

    /* 文本区 */
    const tcard = el("div", {class: "card"});
    tcard.appendChild(el("div", {class: "card-title", html: icon("feather", 18) + "<span>常用文本</span>"}));
    tcard.querySelector(".card-title").appendChild(el("button", {class: "btn sm primary", style: {marginLeft: "auto"},
      html: icon("plus", 13) + "<span>添加</span>", onclick: () => textModal(null)}));
    if(!texts.all().length){
      tcard.appendChild(WB.ui.emptyState("feather", "存一段常用文本", "自我介绍、地址、卡号后四位…点一下就复制"));
    }else{
      const grid = el("div", {class: "grid grid-2"});
      texts.all().slice().sort((a, b) => a.createdAt - b.createdAt).forEach(t => {
        const cell = el("div", {class: "card hoverable", style: {padding: "14px", cursor: "pointer", background: "var(--card-2)", boxShadow: "none"},
          onclick: () => WB.copyText(t.content).then(() => WB.ui.toast("已复制「" + t.title + "」"))},
          el("div", {class: "row"},
            el("div", {class: "grow", style: {fontWeight: "600"}, text: t.title}),
            el("button", {class: "icon-btn", html: icon("copy", 14), title: "复制",
              onclick: e => { e.stopPropagation(); WB.copyText(t.content).then(() => WB.ui.toast("已复制")); }}),
            el("button", {class: "icon-btn", html: icon("edit", 14),
              onclick: e => { e.stopPropagation(); textModal(t); }})),
          el("div", {class: "small muted", style: {marginTop: "6px", maxHeight: "60px", overflow: "hidden",
            whiteSpace: "pre-wrap", wordBreak: "break-all"}, text: t.content.slice(0, 120) + (t.content.length > 120 ? "…" : "")}));
        grid.appendChild(cell);
      });
      tcard.appendChild(grid);
    }
    view.appendChild(tcard);
  },
});
})();

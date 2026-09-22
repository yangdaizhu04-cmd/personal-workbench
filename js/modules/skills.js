/* modules/skills.js —— 技能学习空间：技能卡 / 教程链接（B站内嵌播放）/ 进度里程碑 / 番茄时长联动 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const skills = WB.collection("skills");

function bvOf(url){
  const m = String(url).match(/BV[0-9A-Za-z]{8,12}/);
  return m ? m[0] : null;
}
function minutesOfSkill(id){
  return WB.store.get("pomoLog", []).filter(l => l.bindType === "skill" && l.bindId === id && l.status === "done")
    .reduce((s, l) => s + l.minutes, 0);
}

function skillModal(existing){
  const isNew = !existing;
  const s = Object.assign({name: "", desc: "", progress: 0, milestones: [], links: []}, existing || {});
  const body = el("div");
  const name = el("input", {class: "input", value: s.name, placeholder: "技能名，如：剪辑 / 英语 / 编程"});
  const desc = el("input", {class: "input", value: s.desc || "", placeholder: "一句话目标（可选）"});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "技能名"}), name));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "目标"}), desc));
  const m = WB.ui.modal({
    title: isNew ? "新建技能卡" : "编辑技能", icon: "zap", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        // 删完给撤销条兜底（回收站 30 天），不再拦一次确认
        skills.remove(s.id); m.close(); WB.router.render();
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const nv = name.value.trim();
        if(!nv){ name.focus(); return; }
        const patch = {name: nv, desc: desc.value.trim()};
        if(isNew) skills.add(patch);
        else skills.update(s.id, patch);
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => name.focus(), 60);
}

function detailModal(s){
  const body = el("div");
  const fresh = skills.find(s.id) || s;

  /* 进度 */
  const prog = el("input", {type: "number", class: "input", value: fresh.progress || 0, min: 0, max: 100, style: {width: "100px"}});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "学习进度（%）"}), prog));

  /* 里程碑 */
  const msBox = el("div", {class: "col", style: {gap: "6px", marginBottom: "14px"}});
  const renderMs = () => {
    msBox.innerHTML = "";
    (fresh.milestones || []).forEach((ms, i) => {
      msBox.appendChild(el("div", {class: "row", style: {padding: "7px 10px", background: "var(--card-2)", borderRadius: "10px"}},
        el("button", {html: icon(ms.done ? "check-circle" : "circle", 17),
          style: {color: ms.done ? "var(--ok)" : "var(--ink-3)", display: "flex"},
          onclick: () => { fresh.milestones[i].done = !ms.done; persist(); renderMs(); }}),
        el("span", {class: "grow small" + (ms.done ? " faint" : ""), style: ms.done ? {textDecoration: "line-through"} : {}, text: ms.title}),
        el("button", {class: "icon-btn", html: icon("close", 12), onclick: () => { fresh.milestones.splice(i, 1); persist(); renderMs(); }})));
    });
    if(!(fresh.milestones || []).length) msBox.appendChild(el("div", {class: "small faint", text: "还没有里程碑"}));
  };
  const msIn = el("input", {class: "input", placeholder: "添加里程碑，如：完成第一支 Vlog，回车确认"});
  msIn.addEventListener("keydown", e => {
    if(e.key === "Enter" && msIn.value.trim()){
      fresh.milestones = fresh.milestones || [];
      fresh.milestones.push({title: msIn.value.trim(), done: false});
      msIn.value = ""; persist(); renderMs();
    }
  });
  body.appendChild(el("div", {class: "field"}, el("label", {text: "里程碑"}), msIn, msBox));

  /* 教程链接 */
  const linkBox = el("div", {class: "col", style: {gap: "6px"}});
  const renderLinks = () => {
    linkBox.innerHTML = "";
    (fresh.links || []).forEach((l, i) => {
      const bv = bvOf(l.url);
      linkBox.appendChild(el("div", {class: "row", style: {padding: "7px 10px", background: "var(--card-2)", borderRadius: "10px"}},
        el("span", {class: "grow small ellipsis", text: l.title || l.url}),
        bv ? el("button", {class: "btn sm primary", text: "▶ 内嵌播放",
          onclick: () => biliModal(bv, l.title)}) : null,
        el("button", {class: "icon-btn", html: icon("external", 13), onclick: () => window.open(l.url, "_blank")}),
        el("button", {class: "icon-btn", html: icon("close", 12), onclick: () => { fresh.links.splice(i, 1); persist(); renderLinks(); }})));
    });
    if(!(fresh.links || []).length) linkBox.appendChild(el("div", {class: "small faint", text: "添加教程链接（B站视频可内嵌播放）"}));
  };
  const linkTitle = el("input", {class: "input", placeholder: "教程名", style: {marginBottom: "6px"}});
  const linkUrl = el("input", {class: "input", placeholder: "链接（支持 B 站视频 BV 号自动识别）"});
  linkUrl.addEventListener("keydown", e => {
    if(e.key === "Enter" && linkUrl.value.trim()){
      fresh.links = fresh.links || [];
      fresh.links.push({title: linkTitle.value.trim() || linkUrl.value.slice(0, 24), url: linkUrl.value.trim()});
      linkTitle.value = ""; linkUrl.value = ""; persist(); renderLinks();
    }
  });
  body.appendChild(el("div", {class: "field"}, el("label", {text: "教程链接"}),
    linkTitle, linkUrl, linkBox));

  function persist(){ skills.update(s.id, {milestones: fresh.milestones, links: fresh.links}); }

  const m = WB.ui.modal({title: "⚡ " + fresh.name + " · 累计专注 " + Math.round(minutesOfSkill(s.id)) + " 分钟",
    icon: "zap", content: body, wide: true,
    actions: [{label: "完成", primary: true, onClick: () => {
      skills.update(s.id, {progress: WB.clamp(parseInt(prog.value) || 0, 0, 100)});
      WB.router.render();
    }}]});
  renderMs(); renderLinks();
}

function biliModal(bv, title){
  const wrap = el("div", {style: {position: "relative", width: "100%", aspectRatio: "16/9", borderRadius: "12px", overflow: "hidden", background: "#000"}});
  const iframe = el("iframe", {
    src: "https://player.bilibili.com/player.html?bvid=" + bv + "&autoplay=0&high_quality=1",
    style: {position: "absolute", inset: 0, width: "100%", height: "100%", border: "none"},
    allowfullscreen: true, scrolling: "no", frameborder: "0",
  });
  wrap.appendChild(iframe);
  WB.ui.modal({title: "▶ " + (title || "B站视频"), icon: "play", content: wrap, wide: true,
    actions: [{label: "关闭", primary: true, onClick: () => {}}],
    onClose: () => { iframe.src = "about:blank"; }});
}

WB.registerModule({
  id: "skills",
  title: "技能空间",
  icon: "zap",
  sub: function(){
    const arr = skills.all();
    if(!arr.length) return "为热爱留一块自留地";
    const min = arr.reduce((s, k) => s + minutesOfSkill(k.id), 0);
    return arr.length + " 张技能卡 · 累计 " + Math.round(min / 60 * 10) / 10 + " 小时";
  },

  render(view){
    const arr = skills.all().filter(s => !s.archived);
    const bar = el("div", {class: "row", style: {marginBottom: "14px"}});
    bar.appendChild(el("div", {class: "muted small"}, "教程链接收在这里；番茄钟绑定技能卡，专注时长自动累计。"));
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>新建技能卡</span>", onclick: () => skillModal(null)}));
    view.appendChild(bar);

    if(!arr.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("zap", "建第一张技能卡",
        "剪辑、英语、编程…把教程链接收进来，用番茄钟专注学习，时间会替你说话")));
      return;
    }

    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    arr.forEach(s => {
      const pct = s.progress || 0;
      const min = minutesOfSkill(s.id);
      const card = el("div", {class: "card hoverable"},
        el("div", {class: "row", style: {alignItems: "flex-start"}},
          el("span", {class: "center", style: {width: "42px", height: "42px", borderRadius: "14px", background: "var(--accent2-soft)", color: "var(--accent-2)", flex: "none"},
            html: icon("zap", 20)}),
          el("div", {class: "grow", style: {marginLeft: "10px", minWidth: 0}},
            el("div", {style: {fontWeight: "600"}, text: s.name}),
            s.desc ? el("div", {class: "small muted ellipsis", text: s.desc}) : null,
            el("div", {class: "small faint", style: {marginTop: "2px"}},
              "⚡ 已专注 " + Math.round(min) + " 分钟" + ((s.links || []).length ? " · " + s.links.length + " 个教程" : ""))),
          el("button", {class: "icon-btn", html: icon("edit", 15), onclick: () => skillModal(s)})),
        el("div", {class: "row", style: {marginTop: "10px"}},
          el("div", {class: "bar grow"}, el("i", {style: {width: pct + "%"}})),
          el("b", {class: "small", style: {marginLeft: "8px"}, text: pct + "%"})),
        el("div", {class: "row", style: {marginTop: "10px", gap: "6px"}},
          el("button", {class: "btn sm", text: "详情 / 教程", onclick: () => detailModal(s)}),
          el("button", {class: "btn sm ghost", text: "去专注", onclick: () => WB.router.go("pomodoro")})));
      /* 里程碑迷你行 */
      if((s.milestones || []).length){
        const done = s.milestones.filter(m => m.done).length;
        card.appendChild(el("div", {class: "small faint", style: {marginTop: "8px"}, text: "🏁 里程碑 " + done + "/" + s.milestones.length}));
      }
      grid.appendChild(card);
    });
    view.appendChild(grid);
  },
});
})();

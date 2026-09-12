/* modules/media.js —— 书影剧记录馆：书/影/剧/课，封面三选一（上传压缩→IDB / URL / 内置插画），进度评分短评 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const media = WB.collection("media");
const TYPES = {
  book: {label: "书", emoji: "📖", accent: "#7fa3bd"},
  movie: {label: "影", emoji: "🎬", accent: "#b9aade"},
  series: {label: "剧", emoji: "📺", accent: "#d49a6e"},
  course: {label: "课", emoji: "🎓", accent: "#8fbf9f"},
};
const STATUS = {wish: "想看", doing: "在看", done: "看完", drop: "弃"};
let filter = {type: "", status: ""};

/* 内置奶油风插画封面（SVG data URI，按类型配色） */
function coverArt(type, title){
  const a = TYPES[type] ? TYPES[type].accent : "#7fa3bd";
  const short = (title || "?").slice(0, 1);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">' +
    '<rect width="300" height="400" fill="#f6f1e7"/>' +
    '<circle cx="70" cy="90" r="70" fill="' + a + '" opacity=".28"/>' +
    '<circle cx="240" cy="300" r="90" fill="#b9aade" opacity=".2"/>' +
    '<circle cx="220" cy="70" r="34" fill="#eedcb2" opacity=".5"/>' +
    '<text x="150" y="228" font-size="120" text-anchor="middle" fill="' + a + '" opacity=".75" font-family="serif">' + short + '</text></svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
async function coverOf(m){
  if(m.coverKey){
    const rec = await WB.idb.get("cover:" + m.coverKey);
    if(rec && rec.data) return URL.createObjectURL(rec.data);
  }
  if(m.coverUrl) return m.coverUrl;
  return coverArt(m.type, m.title);
}

function itemModal(existing){
  const isNew = !existing;
  const m = Object.assign({type: "book", title: "", status: "doing", progress: "", rating: 0, comment: "", coverUrl: "", coverKey: ""}, existing || {});
  const body = el("div");

  const title = el("input", {class: "input", value: m.title, placeholder: "名称，如：《三体》"});
  const typeSeg = el("div", {class: "seg"});
  Object.entries(TYPES).forEach(([v, t]) => typeSeg.appendChild(el("button", {
    class: m.type === v ? "on" : "", text: t.emoji + " " + t.label, dataset: {v},
    onclick: () => { typeSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); },
  })));
  const statusSeg = el("div", {class: "seg"});
  Object.entries(STATUS).forEach(([v, l]) => statusSeg.appendChild(el("button", {
    class: m.status === v ? "on" : "", text: l, dataset: {v},
    onclick: () => { statusSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); },
  })));
  const progress = el("input", {class: "input", value: m.progress, placeholder: "进度，如：120 页 / S2E5 / 40%"});
  /* 评分 */
  const stars = el("div", {class: "row", style: {gap: "4px", fontSize: "22px"}});
  let curRate = m.rating;
  const paintStars = () => {
    stars.innerHTML = "";
    for(let i = 1; i <= 5; i++){
      stars.appendChild(el("button", {text: i <= curRate ? "★" : "☆",
        style: {color: i <= curRate ? "#e8cf8f" : "var(--ink-3)", fontSize: "24px"},
        onclick: () => { curRate = curRate === i ? 0 : i; paintStars(); }}));
    }
  };
  paintStars();
  const comment = el("textarea", {class: "input", placeholder: "写几句短评…", style: {minHeight: "70px"}});
  comment.value = m.comment || "";

  /* 封面三选一 */
  let pendingFile = null;
  const coverPrev = el("div", {style: {width: "72px", height: "96px", borderRadius: "10px", background: "var(--card-2)",
    backgroundSize: "cover", backgroundPosition: "center", border: "1px solid var(--card-border)", flex: "none"}});
  const setPrev = url => { coverPrev.style.backgroundImage = "url(" + url + ")"; };
  if(m.coverUrl) setPrev(m.coverUrl);
  const fileIn = el("input", {type: "file", accept: "image/*", style: {display: "none"}});
  fileIn.addEventListener("change", () => {
    if(fileIn.files[0]){
      pendingFile = fileIn.files[0];
      const url = URL.createObjectURL(pendingFile);
      setPrev(url);
      m.coverUrl = ""; m.coverKey = "";
    }
  });
  const urlIn = el("input", {class: "input", placeholder: "在线图片 URL（可选）", value: m.coverUrl || "", style: {fontSize: "13px"}});
  urlIn.addEventListener("change", () => { if(urlIn.value.trim()){ m.coverUrl = urlIn.value.trim(); m.coverKey = ""; pendingFile = null; setPrev(m.coverUrl); } });

  body.appendChild(el("div", {class: "field"}, el("label", {text: "标题"}), title));
  body.appendChild(el("div", {class: "field-row"},
    el("div", {class: "field"}, el("label", {text: "类型"}), typeSeg),
    el("div", {class: "field"}, el("label", {text: "状态"}), statusSeg)));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "进度"}), progress));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "评分"}), stars));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "短评"}), comment));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "封面（上传自动压缩存本地，或贴 URL，或不传用插画）"}),
    el("div", {class: "row", style: {gap: "10px", alignItems: "flex-start"}},
      coverPrev,
      el("div", {class: "grow col", style: {gap: "6px"}},
        el("button", {class: "btn sm", html: icon("image", 14) + "<span>上传图片</span>", onclick: () => fileIn.click()}),
        urlIn))));

  let modalIns;
  modalIns = WB.ui.modal({
    title: isNew ? "记录一本书/影/剧/课" : "编辑", icon: "layers", content: body, wide: true,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        WB.ui.confirmBox("删除「" + esc(m.title) + "」？", {danger: true, okLabel: "删除"}).then(async ok => {
          if(ok){
            if(m.coverKey) await WB.idb.del("cover:" + m.coverKey);
            media.remove(m.id); modalIns.close(); WB.router.render();
          }
        });
        return true;
      }}]),
      {label: "保存", primary: true, onClick: async () => {
        const tv = title.value.trim();
        if(!tv){ title.focus(); return; }
        const patch = {
          title: tv,
          type: typeSeg.querySelector(".on").dataset.v,
          status: statusSeg.querySelector(".on").dataset.v,
          progress: progress.value.trim(),
          rating: curRate,
          comment: comment.value.trim(),
        };
        if(pendingFile){
          try{
            const blob = await WB.idb.compressImage(pendingFile, 400, 0.72);
            const key = WB.uid();
            await WB.idb.put("cover:" + key, blob, {name: tv});
            if(m.coverKey) await WB.idb.del("cover:" + m.coverKey);
            patch.coverKey = key; patch.coverUrl = "";
          }catch(e){ WB.ui.toast("图片处理失败，改用默认封面", "warn"); }
        }
        if(isNew) media.add(patch);
        else media.update(m.id, patch);
        modalIns.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => title.focus(), 60);
}

WB.registerModule({
  id: "media",
  title: "书影剧馆",
  icon: "layers",
  sub: function(){
    const month = WB.bizDate().slice(0, 7);
    const n = media.all().filter(m => m.status === "done" && (m.updatedAt || 0) > new Date(month + "-01").getTime()).length;
    return n ? "本月完成 " + n + " 部" : "书 / 影 / 剧 / 课";
  },

  render(view){
    /* 筛选条 */
    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    const tSeg = el("div", {class: "seg"});
    const mkSeg = (seg, entries, cur, onSet) => {
      entries.forEach(([v, l]) => seg.appendChild(el("button", {class: cur === v ? "on" : "", text: l,
        onclick: () => { onSet(v); WB.router.render(); }})));
    };
    mkSeg(tSeg, [["", "全部"], ...Object.entries(TYPES).map(([v, t]) => [v, t.emoji + t.label])], filter.type, v => filter.type = v);
    bar.appendChild(tSeg);
    const sSeg = el("div", {class: "seg"});
    mkSeg(sSeg, [["", "全部状态"], ...Object.entries(STATUS).map(([v, l]) => [v, l])], filter.status, v => filter.status = v);
    bar.appendChild(sSeg);
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>记录一部</span>", onclick: () => itemModal(null)}));
    view.appendChild(bar);

    let arr = media.all().sort((a, b) => b.updatedAt - a.updatedAt);
    if(filter.type) arr = arr.filter(m => m.type === filter.type);
    if(filter.status) arr = arr.filter(m => m.status === filter.status);

    if(!arr.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("layers", "还没有记录",
        "读的书、看的电影、追的剧、上的课，都值得记一笔")));
      return;
    }

    /* 月度看板 */
    const month = WB.bizDate().slice(0, 7);
    const monthDone = media.all().filter(m => m.status === "done" && (m.updatedAt || 0) > new Date(month + "-01").getTime());
    view.appendChild(el("div", {class: "row", style: {marginBottom: "10px", flexWrap: "wrap", gap: "8px"}},
      el("span", {class: "chip"}, "本月读完 " + monthDone.length + " 部"),
      el("span", {class: "chip plain"}, "在看 " + media.all().filter(m => m.status === "doing").length + " 部"),
      el("span", {class: "chip plain"}, "想看 " + media.all().filter(m => m.status === "wish").length + " 部")));

    const grid = el("div", {class: "grid", style: {gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "14px"}});
    arr.forEach(m => {
      const card = el("div", {class: "card hoverable", style: {padding: "10px", cursor: "pointer"},
        onclick: () => itemModal(m)});
      const cover = el("div", {style: {width: "100%", aspectRatio: "3/4", borderRadius: "12px",
        backgroundSize: "cover", backgroundPosition: "center", background: "var(--card-2)"}});
      coverOf(m).then(url => { cover.style.backgroundImage = "url(" + url + ")"; });
      card.appendChild(cover);
      card.appendChild(el("div", {class: "row", style: {marginTop: "8px", gap: "5px"}},
        el("span", {class: "small", text: TYPES[m.type].emoji}),
        el("span", {class: "small muted", text: STATUS[m.status] || ""}),
        el("span", {class: "grow"}),
        m.rating ? el("span", {class: "small", style: {color: "#e8cf8f"}, text: "★".repeat(m.rating)}) : null));
      card.appendChild(el("div", {class: "small", style: {fontWeight: "600", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}, text: m.title}));
      if(m.progress) card.appendChild(el("div", {class: "small faint", text: m.progress}));
      grid.appendChild(card);
    });
    view.appendChild(grid);
  },
});
})();

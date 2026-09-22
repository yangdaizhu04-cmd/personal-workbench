/* modules/podcasts.js —— 播客精选：内置目录 / 每天一档 / 我的收藏 / 跳转收听 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

const daily = dateStr => WB.pickDaily(WB.content.PODCASTS, dateStr);
const favKey = "podcastFavs";
const XY_HOST = "https://www.xiaoyuzhoufm.com/";
function dailyPick(dateStr){
  const p = daily(dateStr || WB.bizDate());
  return {name: p[1], intro: p[2]};
}

/* 小宇宙：网页版没有搜索页（/search?q= 已下线成 404「找不到了」），只有节目主页能直达 →
   有第 4 列 ID 就开主页；没有则复制播客名，让用户去 App 里搜（比开一个空页面好）。 */
function listenXY(p){
  if(p[3]){
    window.open(XY_HOST + "podcast/" + p[3], "_blank");
    return;
  }
  WB.copyText(p[1]).then(() => WB.ui.toast("已复制「" + p[1] + "」，去小宇宙 App 里搜索收听"));
}

function jumpLinks(p){
  const row = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap"}});
  row.appendChild(el("button", {class: "btn sm primary", text: "小宇宙收听",
    title: p[3] ? "打开小宇宙节目主页" : "小宇宙网页版没有搜索页，会复制节目名",
    onclick: () => listenXY(p)}));
  row.appendChild(el("button", {class: "btn sm", text: "Apple Podcasts",
    onclick: () => window.open("https://podcasts.apple.com/search?term=" + encodeURIComponent(p[1]) + "&entity=podcast", "_blank")}));
  return row;
}

WB.registerModule({
  id: "podcasts",
  title: "播客精选",
  icon: "mic",
  sub: () => WB.content.PODCASTS.length + " 档中文好播客",

  render(view){
    const today = WB.bizDate();
    const p = daily(today);
    const favs = WB.store.get(favKey, []);

    /* 今日推荐 */
    const f = favs.includes(p[1]);
    const hero = el("div", {class: "card", style: {marginBottom: "14px", background: "linear-gradient(135deg, var(--accent-soft), var(--accent2-soft))"}});
    hero.appendChild(el("div", {class: "row", style: {alignItems: "flex-start"}},
      el("div", {class: "center", style: {width: "64px", height: "64px", borderRadius: "18px", background: "var(--card)", boxShadow: "var(--shadow-s)", fontSize: "30px", flex: "none"}, text: "🎧"}),
      el("div", {class: "grow", style: {marginLeft: "14px", minWidth: 0}},
        el("div", {class: "small", style: {color: "var(--accent-ink)"}, text: "今天随机推荐 · " + p[0]}),
        el("div", {style: {fontSize: "20px", fontWeight: "700", marginTop: "2px"}, text: p[1]}),
        el("div", {class: "small muted", style: {marginTop: "4px", lineHeight: 1.8}, text: p[2]})),
      el("button", {class: "icon-btn", title: f ? "取消收藏" : "收藏", html: icon("star", 18),
        style: {color: f ? "#e8cf8f" : "var(--ink-3)"},
        onclick: () => {
          const arr = WB.store.get(favKey, []).filter(x => x !== p[1]);
          if(!f) arr.push(p[1]);
          WB.store.set(favKey, arr);
          WB.router.render();
        }})));
    hero.appendChild(jumpLinks(p));
    view.appendChild(hero);

    /* 分类列表 */
    const cats = [...new Set(WB.content.PODCASTS.map(x => x[0]))];
    let curCat = "";
    const catBar = el("div", {class: "seg", style: {marginBottom: "12px"}});
    const listCard = el("div", {class: "card"});
    view.appendChild(catBar);
    view.appendChild(listCard);
    const paint = () => {
      catBar.innerHTML = "";
      catBar.appendChild(el("button", {class: curCat === "" ? "on" : "", text: "全部",
        onclick: () => { curCat = ""; paint(); }}));
      cats.forEach(c => catBar.appendChild(el("button", {class: curCat === c ? "on" : "", text: c,
        onclick: () => { curCat = c; paint(); }})));
      const list = el("div", {class: "list"});
      WB.content.PODCASTS.filter(x => !curCat || x[0] === curCat).forEach(x => {
        const isFav = WB.store.get(favKey, []).includes(x[1]);
        list.appendChild(el("div", {class: "list-row"},
          el("span", {class: "chip plain", text: x[0]}),
          el("div", {class: "grow", style: {minWidth: 0}},
            el("div", {}, el("b", {text: x[1]}), isFav ? el("span", {style: {color: "#e8cf8f", marginLeft: "6px"}, text: "★"}) : null),
            el("div", {class: "small muted ellipsis", text: x[2]})),
          el("button", {class: "icon-btn", title: "收藏", html: icon("star", 16),
            style: {color: isFav ? "#e8cf8f" : "var(--ink-3)"},
            onclick: () => {
              const arr = WB.store.get(favKey, []).filter(y => y !== x[1]);
              if(!isFav) arr.push(x[1]);
              WB.store.set(favKey, arr);
              paint();
            }}),
          el("button", {class: "btn sm", text: "收听",
            title: x[3] ? "打开小宇宙节目主页" : "小宇宙网页版没有搜索页，会复制节目名",
            onclick: () => listenXY(x)})));
      });
      listCard.innerHTML = "";
      listCard.appendChild(el("div", {class: "card-title", html: icon("list", 18) + "<span>全部播客</span>"}));
      listCard.appendChild(list);
    };
    paint();
  },

  dailyPick,
});

WB.podcasts = {dailyPick};
})();

/* modules/books.js —— 读书推荐：多主题书单 / 今日一书 / 跳转豆瓣·微信读书 / 一键收进书影剧馆 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

function dailyPick(dateStr){
  const all = WB.content.BOOK_THEMES.flatMap(t => t.books.map(b => ({theme: t.name, title: b[0], author: b[1], line: b[2]})));
  return WB.pickDaily(all, dateStr || WB.bizDate());
}

WB.registerModule({
  id: "books",
  title: "读书推荐",
  icon: "book-open",
  sub: () => "今天读什么 · 内置书单永不断网",

  render(view){
    const today = WB.bizDate();
    const b = dailyPick(today);

    /* 今日一书 */
    const hero = el("div", {class: "card", style: {marginBottom: "14px", background: "linear-gradient(135deg, var(--accent-soft), var(--accent2-soft))"}});
    hero.appendChild(el("div", {class: "row", style: {alignItems: "flex-start"}},
      el("div", {class: "center", style: {width: "64px", height: "88px", borderRadius: "10px", background: "var(--card)", boxShadow: "var(--shadow-s)", fontSize: "26px", flex: "none"}, text: "📖"}),
      el("div", {class: "grow", style: {marginLeft: "14px", minWidth: 0}},
        el("div", {class: "small", style: {color: "var(--accent-ink)"}, text: "今日一书 · " + b.theme}),
        el("div", {style: {fontSize: "20px", fontWeight: "700", marginTop: "2px"}, text: "《" + b.title + "》"}),
        el("div", {class: "small muted", text: b.author}),
        el("div", {class: "small", style: {marginTop: "6px", lineHeight: 1.9}, text: "「" + b.line + "」"}))));
    const actions = el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap", marginTop: "10px"}});
    actions.appendChild(el("button", {class: "btn sm primary", text: "豆瓣搜索",
      onclick: () => window.open("https://search.douban.com/book/subject_search?search_text=" + encodeURIComponent(b.title), "_blank")}));
    actions.appendChild(el("button", {class: "btn sm", text: "微信读书",
      onclick: () => window.open("https://weread.qq.com/web/search/books?keyword=" + encodeURIComponent(b.title), "_blank")}));
    actions.appendChild(el("button", {class: "btn sm", text: "📥 收进书影剧馆",
      onclick: () => {
        WB.collection("media").add({title: b.title, type: "book", status: "wish", progress: "", rating: 0, comment: b.line});
        WB.ui.toast("已收进书影剧馆「想读」");
        WB.router.render();
      }}));
    if(!window.WB_SINGLE_FILE)
      actions.appendChild(el("button", {class: "btn sm", text: "📚 3D 书架",
        onclick: () => toggleShelf(view, hero)}));
    hero.appendChild(actions);
    view.appendChild(hero);

    /* 3D 书架（ThreeUI BookshelfScene，按需加载 1.7MB island） */
    function toggleShelf(view, anchor){
      const exist = view.querySelector("#books-shelf");
      if(exist){ exist.remove(); return; }
      const shelf = el("div", {id: "books-shelf", "data-state": "loading", style: {marginBottom: "14px"}});
      anchor.after(shelf);
      if(!document.getElementById("shelf-island-script")){
        const sc = document.createElement("script");
        sc.id = "shelf-island-script";
        sc.src = "vendor/threeui/islands/shelf.js";
        sc.onerror = () => { shelf.dataset.state = "off"; shelf.innerHTML = "<div style='padding:20px;text-align:center' class='small muted'>书架加载失败</div>"; };
        document.body.appendChild(sc);
      }
    }

    /* 主题书单 */
    const tabs = el("div", {class: "seg", style: {marginBottom: "12px"}});
    const listCard = el("div", {class: "card"});
    view.appendChild(tabs);
    view.appendChild(listCard);
    let cur = WB.content.BOOK_THEMES[0].id;
    const paint = () => {
      tabs.innerHTML = "";
      WB.content.BOOK_THEMES.forEach(t => tabs.appendChild(el("button", {
        class: cur === t.id ? "on" : "", text: t.name,
        onclick: () => { cur = t.id; paint(); }})));
      const theme = WB.content.BOOK_THEMES.find(x => x.id === cur);
      const list = el("div", {class: "list"});
      theme.books.forEach(bk => {
        const inShelf = WB.store.get("media", []).some(m => m.title === bk[0]);
        list.appendChild(el("div", {class: "list-row"},
          el("div", {class: "grow", style: {minWidth: 0, cursor: "pointer"},
            onclick: () => window.open("https://weread.qq.com/web/search/books?keyword=" + encodeURIComponent(bk[0]), "_blank")},
            el("div", {}, el("b", {text: "《" + bk[0] + "》"}), el("span", {class: "small faint", style: {marginLeft: "6px"}, text: bk[1]})),
            el("div", {class: "small muted", text: bk[2]})),
          inShelf ? el("span", {class: "small", style: {color: "var(--ok)"}, text: "已收藏 ✓"})
            : el("button", {class: "btn sm", text: "＋书架",
              onclick: () => {
                WB.collection("media").add({title: bk[0], type: "book", status: "wish", progress: "", rating: 0, comment: bk[2]});
                WB.ui.toast("已收进书影剧馆");
                paint();
              }})));
      });
      listCard.innerHTML = "";
      listCard.appendChild(el("div", {class: "card-title", html: icon("book", 18) + "<span>" + theme.name + " · " + theme.books.length + " 本</span><span class='card-sub'>点击书名直达微信读书</span>"}));
      listCard.appendChild(list);
    };
    paint();
  },

  dailyPick,
});

WB.books = {dailyPick};
})();

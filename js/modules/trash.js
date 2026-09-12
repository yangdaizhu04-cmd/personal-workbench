/* modules/trash.js —— 回收站：30 天保留、恢复、彻底删除 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

const MODULE_MAP = {
  todos: {coll: "todos", name: "待办", titleKey: "title"},
  todoLists: {coll: "todoLists", name: "清单", titleKey: "name"},
  habits: {coll: "habits", name: "习惯", titleKey: "name"},
  habitLogs: {coll: "habitLogs", name: "打卡记录", titleKey: "date"},
  journals: {coll: "journals", name: "日志", titleKey: "date"},
  moods: {coll: "moods", name: "心情", titleKey: "date"},
  notes: {coll: "notes", name: "笔记", titleKey: "content"},
  ledger: {coll: "ledger", name: "账单", titleKey: "note"},
  ledgerCats: {coll: "ledgerCats", name: "分类", titleKey: "name"},
  links: {coll: "links", name: "链接", titleKey: "name"},
  texts: {coll: "texts", name: "常用文本", titleKey: "title"},
  goals: {coll: "goals", name: "月度目标", titleKey: "title"},
  countdowns: {coll: "countdowns", name: "倒数日", titleKey: "name"},
  wishes: {coll: "wishes", name: "愿望", titleKey: "title"},
  media: {coll: "media", name: "书影剧", titleKey: "title"},
  skills: {coll: "skills", name: "技能卡", titleKey: "name"},
  doodles: {coll: "doodles", name: "涂鸦", titleKey: "name"},
};

function titleOf(moduleName, data){
  const def = MODULE_MAP[moduleName];
  if(!def) return "(未知条目)";
  const v = data[def.titleKey];
  return String(v == null || v === "" ? "(无标题)" : v).slice(0, 40);
}

WB.registerModule({
  id: "trash",
  title: "回收站",
  icon: "trash",
  sub: function(){
    const n = WB.store.get("trash", []).length;
    return n ? n + " 件 · 保留 30 天" : "删除的内容会在这里停留 30 天";
  },

  render(view){
    const trash = WB.store.get("trash", []).sort((a, b) => b.deletedAt - a.deletedAt);

    const bar = el("div", {class: "row", style: {marginBottom: "14px"}});
    bar.appendChild(el("div", {class: "muted small"}, "误删不必慌，30 天内都能救回来。过期自动清理。"));
    bar.appendChild(el("span", {class: "grow"}));
    if(trash.length){
      bar.appendChild(el("button", {class: "btn sm danger", text: "清空回收站",
        onclick: async () => {
          const ok = await WB.ui.confirmBox("彻底删除全部 " + trash.length + " 件？此操作不可恢复。", {danger: true, okLabel: "全部删除"});
          if(ok){ WB.store.set("trash", []); WB.ui.toast("已清空"); WB.router.render(); }
        }}));
    }
    view.appendChild(bar);

    if(!trash.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("trash", "回收站是空的", "这是好事 ✨")));
      return;
    }

    const card = el("div", {class: "card"});
    const list = el("div", {class: "list"});
    trash.forEach(t => {
      const def = MODULE_MAP[t.module];
      const left = Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 86400000));
      list.appendChild(el("div", {class: "list-row"},
        el("span", {class: "chip plain", text: def ? def.name : t.module}),
        el("span", {class: "grow ellipsis", text: titleOf(t.module, t.data)}),
        el("span", {class: "small faint nowrap", text: left + " 天后清理"}),
        el("button", {class: "btn sm", text: "恢复", onclick: () => restore(t)}),
        el("button", {class: "icon-btn", html: icon("trash", 14), title: "彻底删除",
          onclick: async () => {
            const ok = await WB.ui.confirmBox("彻底删除「" + esc(titleOf(t.module, t.data)) + "」？不可恢复。", {danger: true, okLabel: "删除"});
            if(ok){
              WB.store.set("trash", WB.store.get("trash", []).filter(x => x.id !== t.id));
              WB.router.render();
            }
          }})));
    });
    card.appendChild(list);
    view.appendChild(card);
  },
});

function restore(t){
  const def = MODULE_MAP[t.module];
  if(!def){ WB.ui.toast("该条目无法恢复", "warn"); return; }
  const coll = WB.collection(def.coll);
  coll.add(Object.assign({}, t.data)); // 保留原 id，维持外键关系
  WB.store.set("trash", WB.store.get("trash", []).filter(x => x.id !== t.id));
  WB.ui.toast("已恢复到「" + def.name + "」");
  WB.router.render();
}
})();

/* 02-store.js —— 数据层：localStorage 封装 + 事件总线 + 回收站 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const PREFIX = "wb:";

/* ---- 事件总线 ---- */
const listeners = {};
WB.bus = {
  on(evt, fn){ (listeners[evt] = listeners[evt] || []).push(fn); return () => WB.bus.off(evt, fn); },
  off(evt, fn){ const l = listeners[evt]; if(l) listeners[evt] = l.filter(f => f !== fn); },
  /* 透传全部参数：只写 fn(data) 时，emit(evt, a, b) 的第二参会被静默丢掉（踩坑 #062） */
  emit(evt, ...args){ (listeners[evt] || []).forEach(fn => { try{ fn(...args); }catch(e){ console.error("[bus]", evt, e); } }); },
};

/* ---- KV ---- */
function rawGet(key){
  try{ const v = localStorage.getItem(PREFIX + key); return v == null ? null : JSON.parse(v); }
  catch(e){ return null; }
}
function rawSet(key, val){
  try{ localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; }
  catch(e){
    console.error("[store] set failed", key, e);
    if(WB.ui && WB.ui.toast) WB.ui.toast("本地存储空间不足，请清理数据或导出备份", "warn");
    return false;
  }
}

const store = {
  get(key, def){
    const v = rawGet(key);
    return v == null ? def : v;
  },
  set(key, val){ rawSet(key, val); WB.bus.emit("kv:" + key, val); },
  /* 真正删掉一个键（草稿这类"用完即弃"的数据用，避免导出时带上空壳） */
  del(key){
    try{ localStorage.removeItem(PREFIX + key); }catch(e){}
    WB.bus.emit("kv:" + key, null);
  },
  /* 全量导出 / 导入（不含 netcache） */
  exportAll(){
    const out = {};
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(k && k.startsWith(PREFIX) && !k.startsWith(PREFIX + "netcache:")){
        out[k.slice(PREFIX.length)] = rawGet(k.slice(PREFIX.length));
      }
    }
    return out;
  },
  importAll(obj, {merge} = {}){
    for(const [k, v] of Object.entries(obj || {})){
      if(k.startsWith("netcache:")) continue;
      if(merge){
        const cur = rawGet(k);
        if(k === "settings" || k === "uiPrefs"){
          rawSet(k, Object.assign({}, v, cur || {})); continue;
        }
        if(Array.isArray(v) && Array.isArray(cur)){
          const ids = new Set(cur.map(r => r && r.id));
          rawSet(k, cur.concat(v.filter(r => r && !ids.has(r.id)))); continue;
        }
      }
      rawSet(k, v);
    }
    WB.bus.emit("data:imported", obj);
  },
  /* 网络缓存（带时间戳，降级用） */
  cache(key, data){ rawSet("netcache:" + key, {t: Date.now(), d: data}); },
  readCache(key, maxAgeMs){
    const v = rawGet("netcache:" + key);
    if(!v) return null;
    if(maxAgeMs && Date.now() - v.t > maxAgeMs) return null;
    return v;
  },
};

/* ---- 回收站 ---- */
const TRASH_TTL = 30 * 86400000;
function toTrash(moduleName, records){
  const list = store.get("trash", []);
  const now = Date.now();
  const items = (Array.isArray(records) ? records : [records]).map(r => ({
    id: WB.uid(), module: moduleName, data: r, deletedAt: now, expiresAt: now + TRASH_TTL,
  }));
  store.set("trash", items.concat(list));
  /* 删除即给「撤销」出口：全站所有走回收站的删除都在这里统一弹可撤销提示，
     调用方不必各自实现（模块名 == 集合名，restoreTrash 直接放回原集合）。
     清空回收站 / 彻底删除 / 覆盖导入不走这里，仍保留确认框（不可逆操作） */
  if(WB.ui && WB.ui.undoToast) WB.ui.undoToast(items);
  return items;
}
/* 从回收站取回若干条：按原 id 放回所属集合（回收站页的「恢复」也走这里） */
function restoreTrash(items){
  const ids = new Set((items || []).map(i => i.id));
  (items || []).forEach(it => {
    try{ WB.collection(it.module).add(Object.assign({}, it.data)); }
    catch(e){ console.error("[store] restore failed", it.module, e); }
  });
  store.set("trash", store.get("trash", []).filter(x => !ids.has(x.id)));
}
function purgeExpiredTrash(){
  const list = store.get("trash", []);
  const now = Date.now();
  const keep = list.filter(t => t.expiresAt > now);
  if(keep.length !== list.length) store.set("trash", keep);
}
setInterval(purgeExpiredTrash, 60 * 60 * 1000);

/* ---- 集合 ---- */
function collection(name, opts){
  opts = opts || {};
  const KEY = name;
  const all = () => store.get(KEY, []);
  function save(list, changedEvt){
    store.set(KEY, list);
    WB.bus.emit(changedEvt || ("coll:" + name + ":changed"));
  }
  return {
    key: KEY,
    all,
    find(id){ return all().find(r => r.id === id) || null; },
    add(rec){
      const now = Date.now();
      const full = Object.assign({id: WB.uid(), createdAt: now, updatedAt: now}, rec);
      save(all().concat(full));
      return full;
    },
    update(id, patch){
      const list = all();
      const i = list.findIndex(r => r.id === id);
      if(i < 0) return null;
      list[i] = Object.assign({}, list[i], patch, {updatedAt: Date.now()});
      save(list);
      return list[i];
    },
    remove(id, {trash = true} = {}){
      const list = all();
      const rec = list.find(r => r.id === id);
      if(!rec) return;
      save(list.filter(r => r.id !== id));
      if(trash) toTrash(opts.trashName || name, rec);
    },
    removeMany(ids, {trash = true} = {}){
      const set = new Set(ids);
      const list = all();
      const removed = list.filter(r => set.has(r.id));
      save(list.filter(r => !set.has(r.id)));
      if(trash && removed.length) toTrash(opts.trashName || name, removed);
    },
    replaceAll(list){ save(list || []); },
    save,
  };
}

/* ---- 跨标签页同步（发现 + 广播） ----
   localStorage 的 storage 事件只在「其它」标签页触发（本页自己写自己收不到），
   正好用来感知外部改动。这里只负责发现与广播；什么时候重绘交给路由层决定 ——
   弹窗开着或正在输入时必须挂起，否则会把用户正在填的表单连根拔掉（见 09-router.js） */
addEventListener("storage", e => {
  if(e.storageArea && e.storageArea !== localStorage) return;
  if(e.key !== null && !String(e.key).startsWith(PREFIX)) return;   // 不是本应用的数据
  if(e.key && e.key.startsWith(PREFIX + "netcache:")) return;       // 网络缓存不值得刷界面
  WB.bus.emit("store:external", {key: e.key});
});

WB.store = store;
WB.collection = collection;
WB.toTrash = toTrash;
WB.restoreTrash = restoreTrash;

/* ---- 晨雾币（游戏化结算：完成赚币、奖励商店花币） ----
   只在本地推导与轻 KV，不进云同步白名单；exportAll 全量导出天然带上 */
const COIN_RULES = {todo: 2, todoHigh: 4, habit: 1, habitCount: 2, pomo: 3, big3: 5};
function coinShift(delta, why){
  const c = store.get("coins", {balance: 0, log: []});
  c.balance += delta;
  c.log.unshift({t: Date.now(), delta, why});
  c.log = c.log.slice(0, 30);
  store.set("coins", c);
}
WB.coins = {
  rules: COIN_RULES,
  balance(){ return store.get("coins", {balance: 0}).balance || 0; },
  /* 完成待办赚币 / 取消完成对称扣回（高优先双倍） */
  forTodo(t, done){
    const n = t.prio === "high" ? COIN_RULES.todoHigh : COIN_RULES.todo;
    coinShift(done ? n : -n, done ? "完成待办" : "取消完成");
  },
  forHabit(n){ coinShift(n, "习惯打卡"); },
  forPomo(){ coinShift(COIN_RULES.pomo, "完成番茄"); },
  /* 三大件全完成：每日一次奖励（门闩防取消重勾反复领） */
  big3Bonus(){
    const d = WB.bizDate();
    if(store.get("big3Bonus:" + d, false)) return;
    store.set("big3Bonus:" + d, true);
    coinShift(COIN_RULES.big3, "三大件全完成");
    if(WB.ui && WB.ui.toast) WB.ui.toast("✦ 三大件全完成 +" + COIN_RULES.big3 + " 币");
  },
  spend(cost, name){
    if(this.balance() < cost) return false;
    coinShift(-cost, "兑换 · " + name);
    return true;
  },
  rewards(){ return store.get("coinRewards", []); },
};

/* ---- 晨雾指数（Todoist Karma 思路，渲染期推导不落库）----
   当日完成待办 +5 / 在身逾期任务 -3 / 完成番茄 +2，封顶 0-100 */
WB.karmaDay = function(dateStr){
  const done = store.get("todos", []).filter(t => t.done && t.doneAt &&
    WB.dateStr(new Date(t.doneAt)) === dateStr).length;
  const pomos = store.get("pomoLog", []).filter(l => l.date === dateStr && l.status === "done" && l.mode === "focus").length;
  const overdue = dateStr === WB.bizDate()
    ? store.get("todos", []).filter(t => !t.done && t.date && t.date < dateStr && !(t.repeat && t.repeat.type !== "none")).length
    : 0;
  return Math.max(0, Math.min(100, done * 5 + pomos * 2 - overdue * 3));
};
})();

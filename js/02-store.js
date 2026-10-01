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

/* ---- 写合并：同一宏任务内的多次 set 只落一次盘 ----
   高频写入路径（勾待办、连打多笔账、番茄结算会连续 set 多个 key）让全量 JSON.stringify
   在每 tick 十几遍，而 set 之间只相隔几毫秒。合并后同一 tick 内对同一 key 只序列化一次；
   WB.bus 的 kv: 事件也只在真正落盘时发一次（cloud 的 schedulePush 自带 3s 防抖，不差这几毫秒）。
   store.get 会先读 pending，保证写入后立刻读仍是新值 —— 语义与同步写等价。 */
const pending = new Map();          // key -> 待落盘的最新值
let flushScheduled = false;
function flushNow(){
  flushScheduled = false;
  for(const [k, v] of pending){
    pending.delete(k);
    rawSet(k, v);
    WB.bus.emit("kv:" + k, v);
  }
}
function scheduleFlush(){
  if(flushScheduled) return;
  flushScheduled = true;
  Promise.resolve().then(flushNow);
}
/* 崩溃兜底：microtask flush 前页面被关闭/后台被系统杀掉会丢 pending 写入。
   pagehide 在关闭/切后台/刷新时均触发（含移动端，比 beforeunload 覆盖更全），
   此时同步落盘一次；正常情况下 pending 已空，调用是空转，零成本 */
addEventListener("pagehide", flushNow);

const store = {
  get(key, def){
    /* 优先读未落盘的 pending 值：同一次操作里 set 后立刻 get 必须拿到新值
       （cloud 推送 / 徽章结算 / 渲染 都会在写入后的同一宏任务里再读） */
    if(pending.has(key)) return pending.get(key);
    const v = rawGet(key);
    return v == null ? def : v;
  },
  set(key, val){
    pending.set(key, val);
    scheduleFlush();
  },
  /* 真正删掉一个键（草稿这类"用完即弃"的数据用，避免导出时带上空壳）
     del 保持同步：删除立即可见，避免"删了又被 get 读到旧值"的多义状态 */
  del(key){
    pending.delete(key);
    try{ localStorage.removeItem(PREFIX + key); }catch(e){}
    WB.bus.emit("kv:" + key, null);
  },
  /* 全量导出 / 导入（不含 netcache）。导出/导入都先强制 flush：
     否则 pending 里未落盘的写入会漏出/被覆盖，导出的不是最新数据 */
  exportAll(){
    flushNow();
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
    flushNow();
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
/* 删除墓碑（B2）：删除过的记录 id 单独持久记账，回收站清空/过期也不丢。
   云同步靠它阻止「被删掉的记录在 pull 时复活」—— 回收站只有 30 天 TTL，
   过期被清掉后，云端 pull 回来的旧记录会重新冒出来（除非这里一直在记）。
   M2 有界化：每 key 上限 TOMBSTONE_MAX 条。合并路径（Set/concat）都按 first-seen
   顺序把新 id 追加到尾部，所以「数组头部 = 最旧墓碑」，超限裁头部即可；
   被裁掉的几乎都是真删除的旧记录（恢复/重建的记录会走「回写即清」被移除），
   残留副本复活风险与回收站过期同级，可接受。 */
const TOMBSTONE_MAX = 500;
function trimTombstones(list){
  return list.length > TOMBSTONE_MAX ? list.slice(-TOMBSTONE_MAX) : list;
}
function tombstoneAdd(moduleName, ids){
  const all = store.get("sync:tombstones", {});
  const list = new Set(all[moduleName] || []);
  ids.forEach(id => list.add(id));
  all[moduleName] = trimTombstones(Array.from(list));
  store.set("sync:tombstones", all);
}
function tombstoneRemove(moduleName, ids){
  const all = store.get("sync:tombstones", {});
  const list = (all[moduleName] || []).filter(id => !ids.includes(id));
  if(list.length) all[moduleName] = list;
  else delete all[moduleName];
  store.set("sync:tombstones", all);
}
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
  tombstoneAdd(moduleName, (Array.isArray(records) ? records : [records]).map(r => r && r.id).filter(Boolean));
  return items;
}
/* 从回收站取回若干条：按原 id 放回所属集合（回收站页的「恢复」也走这里） */
function restoreTrash(items){
  const ids = new Set((items || []).map(i => i.id));
  (items || []).forEach(it => {
    try{ WB.collection(it.module).add(Object.assign({}, it.data)); tombstoneRemove(it.module, [it.data && it.data.id]); }
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

/* ---- Schema 版本化与迁移（工程约定，见 开发交接文档 §9）----
   1. 所有「数据体」（字段、键位、格式）的变更都必须升版本：
      SCHEMA 说明当前代码期望的数据版本；wb:schemaVersion 记录本机数据实际版本。
   2. 启动时（main.js boot 最前）执行 WB.store.runMigrations()：
      从本机版本逐级升到 SCHEMA，每级跑已注册的迁移函数，最后回写版本号。
   3. 数据版本高于代码版本（从新版应用拿旧代码打开）绝不降级写：
      只在内存里继续跑，防止把高版本数据写坏。
   首次落地注册表为空（当前所有数据体都没有历史包袱）；
   未来字段变更在此补 migration，旧档案自然升级，不用在渲染处打补丁。 */
const SCHEMA = 2;                      // 版本 2 = 写合并落地后的当前格式（v1 起算）
const migrations = new Map();          // 目标版本 -> fn(store)，升到该版本前依次执行

function rawSchemaVersion(){
  try{ const v = localStorage.getItem(PREFIX + "schemaVersion"); return v == null ? 1 : parseInt(v, 10) || 1; }
  catch(e){ return 1; }
}
function runMigrations(){
  try{
    let v = rawSchemaVersion();
    if(v > SCHEMA){
      console.warn("[store] 本机数据版本(" + v + ")高于当前代码(" + SCHEMA + ")，不做迁移写回，请在读模式下继续");
      return v;
    }
    while(v < SCHEMA){
      const fn = migrations.get(v + 1);
      if(fn) fn(store);
      v++;
      try{ localStorage.setItem(PREFIX + "schemaVersion", String(v)); }catch(e){}
    }
  }catch(e){ console.error("[store] 数据迁移失败，保持原版本继续", e); }
  return rawSchemaVersion();
}
function registerMigration(to, fn){ migrations.set(to, fn); }

WB.store = store;
WB.store.flush = flushNow;
WB.store.SCHEMA = SCHEMA;
WB.store.schemaVersion = rawSchemaVersion;
WB.store.runMigrations = runMigrations;
WB.store.registerMigration = registerMigration;
WB.store.trimTombstones = trimTombstones;   // 供 14-cloud pull 合并墓碑时复用同一上限
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

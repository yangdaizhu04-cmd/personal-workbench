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
  emit(evt, data){ (listeners[evt] || []).forEach(fn => { try{ fn(data); }catch(e){ console.error("[bus]", evt, e); } }); },
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

WB.store = store;
WB.collection = collection;
WB.toTrash = toTrash;
WB.restoreTrash = restoreTrash;
})();

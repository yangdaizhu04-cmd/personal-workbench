/* 03-idb.js —— IndexedDB 大文件仓库（封面图 / 本地音乐 / 涂鸦） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const DB_NAME = "wb-files";
const STORE = "files";
let dbPromise = null;

/* 连接缓存：**只缓存成功的连接**。
   原来 `dbPromise` 连 reject 也缓存：首次打开失败（隐私模式 / 被另一标签升级 / 连接被 GC）
   之后，IDB 就此终身失效 —— 之后每个 put/get/del 都走 catch 分支静默返回 false/null，
   表现是"封面/音乐/快照/涂鸦全都不动"，而且没有任何报错可查（踩坑 #099）。
   现在失败时把缓存清掉（下次调用会重试），并且监听 versionchange 让连接能被换掉。 */
function open(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try{ req = indexedDB.open(DB_NAME, 1); }
    catch(e){ dbPromise = null; reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: "key"});
    };
    req.onsuccess = () => {
      const db = req.result;
      /* 别的标签升级了版本：这条连接马上会失效，主动关掉并让下次重新开。
         不监听的话，本页会在第一次访问时报一个没人看得懂的 InvalidStateError。 */
      db.onversionchange = () => { try{ db.close(); }catch(e){} dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error("indexedDB blocked")); };
  });
  return dbPromise;
}

async function tx(mode){
  const db = await open();
  return db.transaction(STORE, mode).objectStore(STORE);
}

const idb = {
  async put(key, blobOrData, meta){
    try{
      const st = await tx("readwrite");
      return new Promise((resolve, reject) => {
        const rec = {key, data: blobOrData, meta: meta || {}, updatedAt: Date.now()};
        const req = st.put(rec);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }catch(e){ console.error("[idb] put", e); return false; }
  },
  async get(key){
    try{
      const st = await tx("readonly");
      return new Promise((resolve) => {
        const req = st.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }catch(e){ return null; }
  },
  async del(key){
    try{
      const st = await tx("readwrite");
      return new Promise((resolve) => {
        const req = st.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    }catch(e){ return false; }
  },
  async allKeys(prefix){
    try{
      const st = await tx("readonly");
      return new Promise((resolve) => {
        const req = st.getAllKeys();
        req.onsuccess = () => {
          const keys = req.result || [];
          resolve(prefix ? keys.filter(k => String(k).startsWith(prefix)) : keys);
        };
        req.onerror = () => resolve([]);
      });
    }catch(e){ return []; }
  },
  /* 一次解码、多档输出。同一个文件要出多个尺寸时（照片主题：壁纸 1600 + 缩略图 480）
     别再逐档各调一次 compressImage —— 同一张原图会被 <img> 解码好几遍，手机上一张 50MP
     照片就是几百 MB 的峰值内存。这里用 createImageBitmap 解一次、画多档，用完 close() 立刻还内存。
     它解不开的格式（HEIC 等）退回老路逐档 compressImage：行为与以前一模一样，不会更差 */
  async compressImages(file, specs){
    const draw = (src, maxSide, quality) => new Promise((resolve, reject) => {
      let {width: w, height: h} = src;
      const ratio = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * ratio); h = Math.round(h * ratio);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(src, 0, 0, w, h);
      cv.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/jpeg", quality);
    });
    let bmp = null;
    try{
      bmp = await createImageBitmap(file);
      const out = [];
      for(const s of specs) out.push(await draw(bmp, s.maxSide, s.quality));
      return out;
    }catch(e){
      console.warn("[idb] 单次解码不可用，退回逐档压缩", e);
      const out = [];
      for(const s of specs) out.push(await idb.compressImage(file, s.maxSide, s.quality));
      return out;
    }finally{ if(bmp && bmp.close) bmp.close(); }
  },
  /* 图片压缩：最长边 400px，JPEG 质量 0.72（封面 ≈30-60KB） */
  compressImage(file, maxSide = 400, quality = 0.72){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let {width: w, height: h} = img;
        const ratio = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * ratio); h = Math.round(h * ratio);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        cv.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/jpeg", quality);
      };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  },
};
WB.idb = idb;
})();

/* 03-idb.js —— IndexedDB 大文件仓库（封面图 / 本地音乐 / 涂鸦） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const DB_NAME = "wb-files";
const STORE = "files";
let dbPromise = null;

function open(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try{ req = indexedDB.open(DB_NAME, 1); }
    catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: "key"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

/* 08-network.js —— 网络层：超时/缓存/静默降级（永不抛错，失败返回 null） */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

let online = navigator.onLine;
addEventListener("online", () => { online = true; WB.bus.emit("net:online"); });
addEventListener("offline", () => { online = false; WB.bus.emit("net:offline"); });

/**
 * getJSON(url, opts)
 *  - timeout: 超时 ms（默认 8000）
 *  - cacheKey / cacheMs: 成功后写缓存；失败时读缓存兜底
 *  返回：data | null（绝不 throw）
 */
async function getJSON(url, opts){
  opts = opts || {};
  const {timeout = 8000, cacheKey, cacheMs = 0} = opts;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try{
    const res = await fetch(url, {signal: controller && controller.signal, mode: "cors", credentials: "omit"});
    clearTimeout(timer);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if(cacheKey) WB.store.cache(cacheKey, data);
    return data;
  }catch(e){
    clearTimeout(timer);
    // 静默降级：尝试缓存
    if(cacheKey){
      const c = WB.store.readCache(cacheKey, cacheMs || Infinity);
      if(c) return c.d;
    }
    return null;
  }
}

/* 只请求图片是否可用（img 标签不受 CORS 限制，用于壁纸等） */
function pingImage(url, timeout = 8000){
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => { img.src = ""; resolve(false); }, timeout);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

/* JSONP（部分免费接口需要；失败返回 null） */
let jsonpSeq = 0;
function jsonp(url, {param = "callback", timeout = 8000} = {}){
  return new Promise(resolve => {
    const name = "__wb_jsonp_" + (++jsonpSeq);
    const script = document.createElement("script");
    const timer = setTimeout(done, timeout);
    function done(){
      clearTimeout(timer);
      try{ delete window[name]; }catch(e){ window[name] = undefined; }
      script.remove();
    }
    window[name] = data => { done(); resolve(data); };
    script.onerror = () => { done(); resolve(null); };
    script.src = url + (url.includes("?") ? "&" : "?") + param + "=" + name;
    document.head.appendChild(script);
  });
}

WB.net = {
  get online(){ return online; },
  isFile: location.protocol === "file:",
  getJSON, pingImage, jsonp,
};
})();

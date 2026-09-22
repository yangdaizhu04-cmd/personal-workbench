/* Service Worker —— 云端版专用（本地 file:// 双击版自动跳过注册）
   策略：静态资源 cache-first + 后台更新；API 请求不缓存 */
const CACHE = "wb-cache-v3";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/main.css",
  "./vendor/font/lxgw-wenkai-subset.woff2",
  "./vendor/audio/rain.ogg",
  "./vendor/audio/waves.ogg",
  "./vendor/audio/fire.ogg",
  "./vendor/audio/white.ogg",
  "./vendor/audio/piano.ogg",
  "./vendor/audio/pad.ogg",
  "./vendor/audio/lofi.ogg",
  "./vendor/threeui/islands/core.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(e.request.method !== "GET") return;          // 同步/AI 等 POST 不拦截
  if(url.origin !== location.origin) return;      // 跨域 API（天气/汇率等）不拦截
  e.respondWith(
    caches.match(e.request).then(hit => {
      const fetching = fetch(e.request).then(res => {
        if(res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});

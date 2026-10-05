/* Service Worker —— 云端版专用（本地 file:// 双击版自动跳过注册）
   策略：静态资源 cache-first + 后台更新；API 请求不缓存 */
const CACHE = "wb-cache-v8";   // 安全整改轮（踩坑 #098）：修 SW 预缓存清单（原来含 3 个产物里不存在的文件，addAll 整体失败 → 离线能力实为 0）+ 导入覆盖语义 + 金额口径 → 升版让老 PWA 用户拿到新壳
/* 这一份列表是**云端单文件版**的清单（`node build.js --cloud` 会用同样的项覆盖它）。
   改动前 build.js 生成的清单里有 `./css/main.css`、`./vendor/font/…woff2`、
   `./vendor/threeui/islands/core.js` —— 而单文件产物里这三样都已经内联/剥离了，压根不存在。
   `cache.addAll()` 有一项 404 就整体 reject → install 失败 → SW 永不激活，
   而注册那行被 try/catch 吞掉，症状只是"离线打不开"（踩坑 #098）。 */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./vendor/audio/rain.ogg",   // 录音预缓存（七源合计约 6MB，保证离线可用）
  "./vendor/audio/waves.ogg",
  "./vendor/audio/fire.ogg",
  "./vendor/audio/white.ogg",
  "./vendor/audio/piano.ogg",
  "./vendor/audio/pad.ogg",
  "./vendor/audio/lofi.ogg",
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

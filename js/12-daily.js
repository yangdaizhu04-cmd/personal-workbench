/* 12-daily.js —— 联网内容层：每日一句 / 天气+AQI / IP定位 / 汇率 / 每日热点 / 治愈一刻
   原则：所有请求带超时，失败静默降级（读缓存→内置兜底→隐藏），绝不报错 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* ================= 每日一句 ================= */
async function getQuote(dateStr){
  const src = WB.theme.get("quoteSource") || "hitokoto";
  const ck = "quote:" + dateStr + ":" + src;
  const cache = WB.store.readCache(ck, 86400000 * 3);
  if(cache && cache.d && cache.d.zh) return Object.assign({cached: true}, cache.d);
  let r = null;
  if(src === "hitokoto"){
    const d = await WB.net.getJSON("https://v1.hitokoto.cn/?encode=json&c=i&c=k", {timeout: 6000});
    if(d && d.hitokoto) r = {zh: d.hitokoto, en: "", from: d.from || "一言"};
  }else if(src === "jinrishici"){
    const d = await WB.net.getJSON("https://v1.jinrishici.com/all.json", {timeout: 6000});
    if(d && d.content) r = {zh: d.content, en: "", from: "《" + (d.origin || "佚名") + "》" + (d.author || "")};
  }
  if(r) WB.store.cache(ck, r); // 只缓存映射后的结构（zh/en/from）
  return r; // null → today 卡片用内置语录
}

/* ================= 天气 ================= */
const WMO = {
  0: ["☀️", "晴"], 1: ["🌤", "多云"], 2: ["⛅️", "多云"], 3: ["☁️", "阴"],
  45: ["🌫", "雾"], 48: ["🌫", "雾凇"],
  51: ["🌦", "小雨"], 53: ["🌦", "中雨"], 55: ["🌧", "大雨"],
  61: ["🌧", "小雨"], 63: ["🌧", "中雨"], 65: ["⛈", "大雨"],
  66: ["🌧", "冻雨"], 67: ["🌧", "冻雨"],
  71: ["🌨", "小雪"], 73: ["🌨", "中雪"], 75: ["❄️", "大雪"], 77: ["🌨", "米雪"],
  80: ["🌦", "阵雨"], 81: ["🌧", "阵雨"], 82: ["⛈", "强阵雨"],
  85: ["🌨", "阵雪"], 86: ["🌨", "阵雪"],
  95: ["⛈", "雷雨"], 96: ["⛈", "雷雨冰雹"], 99: ["⛈", "雷雨冰雹"],
};
function weatherHint(code, temp, aqi){
  const tips = [];
  if(temp <= 5) tips.push("很冷，穿厚点");
  else if(temp <= 12) tips.push("有点凉，加件外套");
  else if(temp >= 32) tips.push("很热，注意防晒补水");
  if([51,53,55,61,63,65,66,67,80,81,82,95,96,99].includes(code)) tips.push("记得带伞");
  if([71,73,75,77,85,86].includes(code)) tips.push("路面湿滑，慢点走");
  if(aqi != null){
    if(aqi > 150) tips.push("空气较差，少户外戴好口罩");
    else if(aqi > 100) tips.push("空气一般，敏感人群注意");
    else if(aqi <= 50) tips.push("空气很好，适合开窗");
  }
  return tips.join(" · ");
}
async function getLocation(){
  const manual = WB.theme.get("weatherCity");
  if(manual){
    const ck = "geo:" + manual;
    const d = await WB.net.getJSON("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(manual) + "&count=1&language=zh", {timeout: 6000, cacheKey: ck});
    if(d && d.results && d.results[0]){
      const g = d.results[0];
      return {city: g.name, lat: g.latitude, lon: g.longitude};
    }
    return null;
  }
  const ck = "geo:ip";
  const d = await WB.net.getJSON("https://ipwho.is/", {timeout: 6000, cacheKey: ck});
  if(d && d.success !== false && d.latitude){
    return {city: (d.city || d.region || "") + "", lat: d.latitude, lon: d.longitude};
  }
  return null;
}
async function getWeather(){
  const ck = "weather";
  const cached = WB.store.readCache(ck, 3600000);
  if(cached && cached.d) return Object.assign({cached: true}, cached.d);
  const loc = await getLocation();
  if(!loc) return null;
  const [wx, aq] = await Promise.all([
    WB.net.getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lon +
      "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1", {timeout: 8000, cacheKey: "wx"}),
    WB.net.getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + loc.lat + "&longitude=" + loc.lon +
      "&current=us_aqi&timezone=auto", {timeout: 8000, cacheKey: "aqi"}),
  ]);
  if(!wx || !wx.current) return null;
  const code = wx.current.weather_code;
  const temp = Math.round(wx.current.temperature_2m);
  const aqi = aq && aq.current ? Math.round(aq.current.us_aqi) : null;
  const info = {
    city: loc.city, temp, code,
    icon: (WMO[code] || ["🌤", "多云"])[0], desc: (WMO[code] || ["", "多云"])[1],
    max: wx.daily ? Math.round(wx.daily.temperature_2m_max[0]) : null,
    min: wx.daily ? Math.round(wx.daily.temperature_2m_min[0]) : null,
    aqi,
    hint: weatherHint(code, temp, aqi),
  };
  WB.store.cache(ck, info);
  return info;
}
function renderMini(elx){
  getWeather().then(w => {
    if(!w){ elx.innerHTML = '<span class="faint">天气服务暂不可用</span>'; return; }
    elx.innerHTML = "";
    elx.appendChild(WB.el("div", {style: {display: "inline-flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end"}},
      WB.el("span", {style: {fontSize: "22px"}, text: w.icon}),
      WB.el("span", {}, WB.el("b", {text: w.temp + "°C"}), " ",
        WB.el("span", {class: "faint", text: w.desc + (w.min != null ? " " + w.min + "~" + w.max + "°" : "")})),
      w.aqi != null ? WB.el("span", {class: "chip plain", text: "AQI " + w.aqi}) : null,
      WB.el("div", {class: "small faint", style: {width: "100%", textAlign: "right"}, text: (w.city ? w.city + " · " : "") + (w.hint || "")})));
  });
}

/* ================= 汇率 ================= */
async function getRates(){
  const cached = WB.store.readCache("rates", 12 * 3600000);
  if(cached && cached.d && cached.d.rates) return {data: cached.d, cached: true};
  const d = await WB.net.getJSON("https://open.er-api.com/v6/latest/CNY", {timeout: 8000, cacheKey: "rates"});
  if(d && d.rates) return {data: d, cached: false};
  const old = WB.store.readCache("rates", 86400000 * 30);
  return old && old.d ? {data: old.d, cached: true} : null;
}

/* ================= 每日热点（60秒读懂世界） ================= */
function normHotspot(d){
  if(d && d.code === 200 && Array.isArray(d.data && d.data.news)) return d.data;
  return null;
}
async function getHotspot(){
  const today = WB.bizDate();
  const cached = WB.store.readCache("hotspot:" + today, 86400000);
  if(cached && cached.d) return normHotspot(cached.d);
  const d = await WB.net.getJSON("https://60s.viki.moe/v2/60s", {timeout: 8000, cacheKey: "hotspot:" + today});
  return normHotspot(d);
}
function pickHotspot(){
  getHotspot().then(data => {
    if(!data || !data.news || !data.news.length) return;
    WB.store.set("hotspotData:" + WB.bizDate(), {date: data.date, news: data.news});
  });
  const local = WB.store.get("hotspotData:" + WB.bizDate(), null);
  if(local && local.news.length) return local.news[Math.floor(Math.random() * local.news.length)];
  return null;
}
function openHotspotModal(){
  const local = WB.store.get("hotspotData:" + WB.bizDate(), null);
  const box = WB.el("div");
  if(!local){
    box.appendChild(WB.ui.emptyState("cloud", "还没有加载到今日热点", "联网后自动获取「每天 60 秒读懂世界」"));
  }else{
    box.appendChild(WB.el("div", {class: "small muted", style: {marginBottom: "8px"}, text: local.date + " · 每天 60 秒读懂世界"}));
    const ol = WB.el("ol", {style: {paddingLeft: "20px", lineHeight: 2.1}});
    local.news.forEach(n => ol.appendChild(WB.el("li", {class: "small", text: n})));
    box.appendChild(ol);
  }
  WB.ui.modal({title: "每日热点", icon: "cloud", content: box, wide: true,
    actions: [{label: "关", primary: true, onClick: () => {}}]});
}

/* ================= 治愈一刻（真实宠物图） ================= */
async function fetchPet(container){
  const useCat = Math.random() < .5;
  const url = useCat
    ? "https://api.thecatapi.com/v1/images/search"
    : "https://dog.ceo/api/breeds/image/random";
  const d = await WB.net.getJSON(url, {timeout: 7000});
  const imgUrl = useCat ? (d && d[0] && d[0].url) : (d && d.message);
  if(!imgUrl) return false;
  container.innerHTML = "";
  const img = WB.el("img", {src: imgUrl,
    style: {maxWidth: "100%", maxHeight: "260px", borderRadius: "14px", objectFit: "cover"},
    referrerpolicy: "no-referrer"});
  img.onerror = () => { container.innerHTML = ""; return false; };
  container.appendChild(img);
  container.appendChild(WB.el("div", {class: "small faint", style: {marginTop: "6px"}, text: useCat ? "来自 TheCatAPI" : "来自 dog.ceo"}));
  return true;
}

WB.daily = {getQuote};
WB.weather = {get: getWeather, renderMini};
WB.rates = {get: getRates};
WB.hotspot = {pick: pickHotspot, openAll: openHotspotModal, fetch: getHotspot};
WB.pet = {fetch: fetchPet};
})();

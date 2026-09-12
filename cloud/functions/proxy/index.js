/* 云函数 proxy —— 热搜 / iTunes 播客搜索 / AI 代理（BYOK 直连或云开发大模型兜底） */
const cloud = require("@cloudbase/node-sdk");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});

async function fetchJSON(url, opts){
  const res = await fetch(url, Object.assign({headers: {"Content-Type": "application/json"}}, opts || {}));
  if(!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/* 微博热搜 TOP20（公开接口） */
async function weiboHot(){
  const d = await fetchJSON("https://weibo.com/ajax/side/hotSearch");
  return (d.realtime || []).slice(0, 20).map(x => x.word);
}
/* iTunes 播客搜索 */
async function itunesSearch(term){
  const d = await fetchJSON("https://itunes.apple.com/search?term=" + encodeURIComponent(term) +
    "&media=podcast&entity=podcast&limit=20&country=CN");
  return (d.results || []).map(r => ({
    name: r.collectionName, author: r.artistName, url: r.collectionViewUrl,
    intro: String(r.description || r.primaryGenreName || "").slice(0, 60),
  }));
}

/* AI：BYOK 优先（openai 兼容 / glm / deepseek），否则用云开发大模型 */
async function aiChat(body){
  const messages = body.messages || [];
  const byok = body.byok || {};
  const key = byok.key || "";
  const provider = byok.provider || "";
  const model = byok.model || "";

  if(key && provider === "glm"){
    const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + key},
      body: JSON.stringify({model: model || "glm-4-flash", messages, temperature: 0.6}),
    });
    const d = await r.json();
    return {ok: true, text: d.choices && d.choices[0] && d.choices[0].message.content, via: "glm-byok"};
  }
  if(key && provider === "deepseek"){
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + key},
      body: JSON.stringify({model: model || "deepseek-chat", messages, temperature: 0.6}),
    });
    const d = await r.json();
    return {ok: true, text: d.choices && d.choices[0] && d.choices[0].message.content, via: "deepseek-byok"};
  }
  if(key && provider === "openai"){
    const r = await fetch((byok.baseUrl || "https://api.openai.com/v1") + "/chat/completions", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + key},
      body: JSON.stringify({model: model || "gpt-4o-mini", messages, temperature: 0.6}),
    });
    const d = await r.json();
    return {ok: true, text: d.choices && d.choices[0] && d.choices[0].message.content, via: "openai-byok"};
  }

  /* 免费方案：云开发大模型（环境开通 AIPlus 后可用） */
  try{
    const ai = app.ai;
    const modelObj = ai.createModel("hunyuan-exp");
    const res = await modelObj.generateText({model: "hunyuan-lite", messages});
    return {ok: true, text: res, via: "cloudbase"};
  }catch(e){
    return {ok: false, message: "AI 服务不可用：" + e.message + "（可在设置里填自己的 Key）"};
  }
}

exports.main = async function(event){
  const body = typeof event === "string" ? JSON.parse(event || "{}") : (event || {});
  try{
    if(body.kind === "hot") return {ok: true, data: await weiboHot()};
    if(body.kind === "itunes") return {ok: true, data: await itunesSearch(String(body.term || "科技").slice(0, 40))};
    if(body.kind === "ai") return await aiChat(body);
    return {ok: false, message: "未知 kind"};
  }catch(e){
    return {ok: false, message: e.message};
  }
};

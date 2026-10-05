/* 云函数 proxy —— 热搜 / iTunes 播客搜索 / AI 代理（BYOK 直连或云开发大模型兜底）

   2026-10-05 安全整改（踩坑 #097）。这个函数原先**完全没有鉴权**，后果有三条：
   ① SSRF：`byok.baseUrl` 由请求方任意指定，`fetch(baseUrl + "/chat/completions")`
      能让云函数去请求任意地址 —— 包括云厂商元数据服务（169.254.169.254）
      与内网主机，响应还会被原样回传。
   ② 开放中继：无 key 时走云开发大模型，任何人都能白嫖本项目环境的配额与账单。
   ③ 错误信息泄露：catch 里把 e.message 原样回传。
   改法：① 所有 kind 统一走 token 门（与 sync 同一套会话表）；
        ② 删掉自定义 baseUrl —— BYOK 的"OpenAI 兼容"是给**已知几家**用的，
           开放任意地址等于把 SSRF 敞开；要自定义就自己在本地直连；
        ③ 对外只给一句人话。
*/
const cloud = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});

const SALT = process.env.WB_GATE_SALT;
if(!SALT){
  console.error("[proxy] 缺少环境变量 WB_GATE_SALT —— 请在云函数配置里设置一个长随机串后重新部署");
  throw new Error("WB_GATE_SALT not configured");
}

/* 请求体上限：AI 对话可能稍长，但不该无上限 */
const MAX_BODY_BYTES = 512 * 1024;
const MAX_MESSAGES = 40;

function sha(s){ return crypto.createHash("sha256").update(s).digest("hex"); }

/* 统一超时。不用 AbortSignal.timeout —— 云函数运行时的 Node 版本不一定支持（17.3+ 才有）。 */
function timeoutSignal(ms){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  /* Node 15+ 的定时器不 unref 会吊住进程；这里显式断开引用，超时照常生效 */
  if(t && typeof t.unref === "function") t.unref();
  return c.signal;
}

/** 与 sync/gate 同一套会话口径：token 无效一律 401。
    这个函数原来完全公开，等于任何人都能拿它当免费 AI 中继。 */
async function authed(token){
  if(!token || typeof token !== "string" || token.length > 200) return false;
  const rec = (await db.collection("wb_sessions").where({tokenHash: sha(token)}).limit(1).get()).data[0];
  if(!rec) return false;
  if((rec.expiresAt || 0) <= Date.now()){
    db.collection("wb_sessions").doc(rec._id).remove().catch(() => {});
    return false;
  }
  return true;
}

async function fetchJSON(url){
  const res = await fetch(url, {headers: {"Accept": "application/json"}, signal: timeoutSignal(8000)});
  if(!res.ok) throw new Error("upstream " + res.status);
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

/* ---- BYOK 出口：**只认固定几家**（openai 兼容的第三方服务请在设置里选 glm / deepseek） ---- */
const PROVIDERS = {
  glm: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-flash",
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
};

async function chatUpstream(p, key, messages){
  const res = await fetch(p.url, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: "Bearer " + key},
    body: JSON.stringify({model: p.model, messages, temperature: 0.6}),
    /* 上游也要超时：没有它，一个挂住的上游能把这次调用拖到平台强制回收 */
    signal: timeoutSignal(30000),
  });
  const d = await res.json().catch(() => ({}));
  if(!res.ok){
    const msg = (d && d.error && d.error.message) || ("HTTP " + res.status);
    throw new Error("上游：" + msg.slice(0, 200));
  }
  const text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if(typeof text !== "string" || !text) throw new Error("上游没有返回文本");
  return text;
}

/* AI：BYOK 优先，否则用云开发大模型 */
async function aiChat(body){
  const messages = Array.isArray(body.messages) ? body.messages.slice(0, MAX_MESSAGES) : [];
  const byok = body.byok || {};
  const key = String(byok.key || "");
  const provider = String(byok.provider || "");

  const p = key ? PROVIDERS[provider] : null;
  if(p){
    try{
      const text = await chatUpstream(p, key, messages);
      return {ok: true, text, via: provider + "-byok"};
    }catch(e){
      /* BYOK 失败就说清楚是哪一家、什么原因，不要静默切到免费额度
         （那会让用户以为"用自己的 Key 也能用"，实际已经在花他的额度） */
      console.error("[proxy] BYOK 失败 provider=" + provider, e.message);
      return {ok: false, message: "你的 " + provider + " Key 调用失败：" + String(e.message).slice(0, 120)};
    }
  }

  /* 免费方案：云开发大模型（环境开通 AIPlus 后可用） */
  try{
    const modelObj = app.ai.createModel("hunyuan-exp");
    const text = await modelObj.generateText({model: "hunyuan-lite", messages});
    if(typeof text !== "string" || !text) return {ok: false, message: "AI 没有返回文本，请稍后再试"};
    return {ok: true, text, via: "cloudbase"};
  }catch(e){
    console.error("[proxy] 云开发大模型失败", e.message);
    /* 这条要留可操作的下一步（去设置填自己的 Key），所以文案是产品文案而非堆栈 */
    return {ok: false, message: "云端 AI 暂不可用（可在设置里填自己的 GLM / DeepSeek Key）"};
  }
}

exports.main = async function(event){
  const raw = typeof event === "string" ? event : JSON.stringify(event || {});
  if(raw.length > MAX_BODY_BYTES)
    return {ok: false, message: "请求内容过大"};
  const body = typeof event === "string" ? JSON.parse(raw || "{}") : (event || {});

  if(!await authed(String(body.token || "")))
    return {ok: false, code: "unauthorized", message: "登录已失效，请重新输入访问密码"};

  try{
    if(body.kind === "hot") return {ok: true, data: await weiboHot()};
    if(body.kind === "itunes"){
      return {ok: true, data: await itunesSearch(String(body.term || "科技").slice(0, 40))};
    }
    if(body.kind === "ai") return await aiChat(body);
    return {ok: false, message: "未知 kind"};
  }catch(e){
    /* 细节进日志，不外泄（内部地址 / 上游响应片段） */
    console.error("[proxy] kind=" + body.kind, e);
    return {ok: false, message: "服务暂时不可用，请稍后再试"};
  }
};

/* 云函数 gate —— 访问密码校验（首次自设，服务端校验）
   POST {password} → {ok, token}  token = hmac(password+salt)，后续请求携带 */
const cloud = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});
const db = app.database();

function hmac(str){
  return crypto.createHmac("sha256", "wb-gate-salt-2026").update(str).digest("hex").slice(0, 32);
}

exports.main = async function(event){
  // HTTP 访问集成：event 为解析后的 body
  const body = typeof event === "string" ? JSON.parse(event || "{}") : (event || {});
  const password = String(body.password || "").trim();
  if(password.length < 4) return {ok: false, message: "密码至少 4 位"};

  const coll = db.collection("wb_auth");
  const rec = (await coll.limit(1).get()).data[0];

  if(!rec){
    // 首次使用：设定密码
    await coll.add({pwdHash: hmac(password), createdAt: Date.now()});
    return {ok: true, token: hmac(password + ":wb"), first: true};
  }
  if(rec.pwdHash === hmac(password)){
    return {ok: true, token: hmac(password + ":wb")};
  }
  return {ok: false, message: "密码不对，再想想"};
};

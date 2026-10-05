/* 云函数 gate —— 访问密码校验（首次自设，服务端校验）
   POST {password} → {ok, token}  token = 服务端随机串（不与密码派生）

   2026-10-05 安全整改（踩坑 #097）。改掉的都是"看起来能鉴权、其实等于没有"的点：
   ① 盐硬编码在源码里（而仓库是公开的）→ 移到环境变量 WB_GATE_SALT，缺省时**直接拒绝启动**，
      不再退回一个写在 GitHub 上的默认值（那等于没有盐）。
   ② token = hmac(密码 + ":wb") 是密码的确定性函数：拿到 token 就能离线爆破回密码，
      改密码也不失效旧 token（它是纯函数，没有"改"这个概念）。改成**服务端随机 token**，
      会话落库、带过期、可吊销。
   ③ 密码用一次 HMAC（快哈希）存库，库一泄露即秒破。改成 scrypt + 每人独立 salt。
   ④ 没有速率限制：4 位下限密码可在线无限次尝试。加内存计数（单实例够用，见下）。
*/
const cloud = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});
const db = app.database();

/* 盐必须来自环境变量。给一个编译期常量兜底看着"省事"，但那个常量在公开仓库里，
   等于告诉所有人"你可以离线爆破这个 token" —— 所以宁可在部署时直接失败。 */
const SALT = process.env.WB_GATE_SALT;
if(!SALT){
  console.error("[gate] 缺少环境变量 WB_GATE_SALT —— 请在云函数配置里设置一个长随机串后重新部署");
  throw new Error("WB_GATE_SALT not configured");
}

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;   // 会话 30 天（客户端每次进云端版都会换新会话）

/* 速率限制：单实例内存计数。
   注意这是**尽力而为**而不是硬保证 —— 云函数会多实例并发，冷启动还会重新计数。
   它挡住的是"拿一个脚本慢慢试"这种最常见的形态；真正的强度来自 scrypt 的计算成本。 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRY = 20;
const hits = new Map();
function rateLimited(ip){
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if(list.length >= MAX_TRY) return true;
  list.push(now);
  hits.set(ip, list);
  /* 顺手清一次过期桶，防止 Map 无限长（云函数实例活得久的时候才有意义） */
  if(hits.size > 500){
    for(const [k, v] of hits) if(!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  }
  return false;
}

/* ---- 密码：scrypt（内存硬）+ 每人独立 salt ---- */
function hashPassword(password, salt){
  return crypto.scryptSync(password, salt, 32, {N: 16384, r: 8, p: 1}).toString("hex");
}
function newSalt(){ return crypto.randomBytes(16).toString("hex"); }
/* 定长比较：逐字符比与"短路"比较在耗时上有差异，理论上可被逐字节试探。
   实测在网络噪声下很难用上，但这是密码校验，白写一次不亏。 */
function timingSafeEqual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if(x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function verifyPassword(password, rec){
  if(!rec || !rec.salt || !rec.pwdHash) return false;
  return timingSafeEqual(hashPassword(password, rec.salt), rec.pwdHash);
}

/* ---- token：随机 + 落库 + 过期 ---- */
function issueToken(uid){
  const token = crypto.randomBytes(24).toString("base64url");
  db.collection("wb_sessions").add({
    tokenHash: sha(token),
    uid,
    createdAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  }).catch(e => console.error("[gate] session 落库失败", e));
  return token;
}
function sha(s){ return crypto.createHash("sha256").update(s).digest("hex"); }
/* uid 由密码派生：**同一个密码的两台设备必须算出同一个 uid**（它们要看到同一份数据），
   所以这里不能随机 —— 但仍然拼了服务端私有的盐，外部算不出来。 */
function uidOf(password){
  return "u" + crypto.createHmac("sha256", SALT).update("uid:" + password).digest("hex").slice(0, 12);
}

function clientIp(ctx){
  /* 云开发 HTTP 触发器通常透传 X-Forwarded-For 的第一段。拿不到就算"未知"，
     未知的一律按同一个桶限 —— 宁可严一点。 */
  const h = (ctx && (ctx.headers || {})["x-forwarded-for"]) || "";
  return String(h).split(",")[0].trim() || "unknown";
}

exports.main = async function(event, ctx){
  const body = typeof event === "string" ? JSON.parse(event || "{}") : (event || {});
  const password = String(body.password || "").trim();
  if(password.length < 4) return {ok: false, message: "密码至少 4 位"};

  if(rateLimited(clientIp(ctx)))
    return {ok: false, message: "试得太多了，先歇一会儿再试"};

  const coll = db.collection("wb_auth");
  /* 用固定 _id 取代随机 add：这份数据全局只有一条。
     随机 add 在"首次并发"时会建出两条，而 limit(1) 只认其中一条 ——
     另一个设备就再也进不来了（而且没有任何报错可查）。固定 id 的 set 是幂等的。 */
  const AUTH_ID = "wb_auth_main";
  const rec = (await coll.doc(AUTH_ID).get()).data || null;

  if(!rec){
    const salt = newSalt();
    await coll.doc(AUTH_ID).set({data: {
      uid: uidOf(password),
      salt,
      pwdHash: hashPassword(password, salt),
      createdAt: Date.now(),
    }});
    return {ok: true, token: issueToken(uidOf(password)), first: true};
  }
  if(verifyPassword(password, rec)){
    return {ok: true, token: issueToken(rec.uid || uidOf(password))};
  }
  return {ok: false, message: "密码不对，再想想"};
};

/* 云函数 sync —— 自动双向同步 + 快照
   action:
    push   {token, data:{key: {records:{id:rec}}, deleted:{key:[id]}}}
    pull   {token, since}  → 远端比 since 新的所有数据
    snapshot {token, data, tag}  手动备份
    snapshots {token}  → 快照列表
    restore  {token, ts} → 读取某快照
   冲突策略：记录级 updatedAt 新者胜（push 时对逐条比较）

   2026-10-05 安全整改（踩坑 #097）：
   ① token 之前是"任意非空字符串"，uid 直接由它派生 —— 等于**没有鉴权**：
      任何人都能拿随机 token 建出属于自己的数据空间（存储/费用消耗），
      而真用户的 token 又恰好等于密码的确定性函数（见 gate）。
      现在改成查 `wb_sessions` 拿 uid：token 无效一律 401，两端同一套口径。
   ② 用户文档用固定 _id（原先是随机 add + where 查），并发首访不会再裂成两份。
   ③ payload 与快照加了体积上限；快照份数从"删到剩 30"改成只删自己 uid 的旧份。
*/
const cloud = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});
const db = app.database();

/* 与 gate 共用同一把盐（也要来自环境变量，缺省直接拒绝启动） */
const SALT = process.env.WB_GATE_SALT;
if(!SALT){
  console.error("[sync] 缺少环境变量 WB_GATE_SALT —— 请在云函数配置里设置一个长随机串后重新部署");
  throw new Error("WB_GATE_SALT not configured");
}

/* 单次请求的 JSON 体积上限。超了直接拒，不写库。
   没有上限时，任何人（token 有效即可）都能用一次 snapshot 写进几百 MB。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;      // 8 MB：远超本项目真实数据体（数百 KB）
const MAX_SNAPSHOTS = 30;
const SYNC_KEY_LIMIT = 64;                    // 单次 push/pull 允许出现的键数上限

function sha(s){ return crypto.createHash("sha256").update(s).digest("hex"); }

/** token → uid。查会话表；查不到或已过期一律 null（调用方回 401）。
    token 只以哈希形式落库，数据库被读走也拿不到可直接使用的凭据。 */
async function uidOfToken(token){
  if(!token || typeof token !== "string" || token.length > 200) return null;
  const q = db.collection("wb_sessions").where({tokenHash: sha(token)}).limit(1);
  const rec = (await q.get()).data[0];
  if(!rec) return null;
  if((rec.expiresAt || 0) <= Date.now()){
    /* 过期顺手删掉，避免表无限长；删失败不影响判定 */
    db.collection("wb_sessions").doc(rec._id).remove().catch(() => {});
    return null;
  }
  return rec.uid || null;
}

function dataId(uidv){ return "u_" + sha(uidv).slice(0, 16); }

async function getUserDoc(id){
  return (await db.collection("wb_data").doc(id).get()).data || null;
}

/* 上限检查：JSON 序列化一次只为量体积（数据本来就要 stringify 才能写库） */
function tooLarge(obj){
  try{ return JSON.stringify(obj == null ? {} : obj).length > MAX_BODY_BYTES; }
  catch(e){ return true; }                    // 循环引用 / 不可序列化：当作超限处理，不硬写
}

exports.main = async function(event){
  const raw = typeof event === "string" ? event : JSON.stringify(event || {});
  if(raw.length > MAX_BODY_BYTES)
    return {ok: false, code: "too_large", message: "数据太大，请先清理历史记录再试"};

  const body = typeof event === "string" ? JSON.parse(event || "{}") : (event || {});
  const action = body.action;
  const u = await uidOfToken(String(body.token || ""));
  if(!u) return {ok: false, code: "unauthorized", message: "登录已失效，请重新输入访问密码"};

  const now = Date.now();
  const collData = db.collection("wb_data");
  const id = dataId(u);

  try{
    if(action === "push"){
      const data = body.data || {}; // {key: {records:{id:rec}, deleted:[id]}}
      if(Object.keys(data).length > SYNC_KEY_LIMIT)
        return {ok: false, message: "键数异常，已拒绝"};
      if(tooLarge(data)) return {ok: false, code: "too_large", message: "数据太大，请先清理历史记录再试"};

      let remote = {};
      const doc = await getUserDoc(id);
      if(doc) remote = doc.data || {};
      let merged = 0;
      for(const key of Object.keys(data)){
        const incoming = (data[key] && data[key].records) || {};
        const deleted = (data[key] && data[key].deleted) || [];
        const cur = remote[key] || {records: {}};
        /* 删除墓碑：从远端副本剔除 + 记入远端 deleted，让其它设备 pull 时也知道这些 id 已删
           M3 有界化：与客户端同上限（500）。合并按 first-seen 保序追加，新 id 在尾部，
           裁掉头部最旧墓碑 —— 远端副本不随历史删除量无界膨胀 */
        if(deleted.length){
          cur.records = cur.records || {};
          deleted.forEach(cid => { delete cur.records[cid]; });
          cur.deleted = Array.from(new Set((cur.deleted || []).concat(deleted))).slice(-500);
        }
        for(const rid of Object.keys(incoming)){
          const r = incoming[rid];
          const old = cur.records[rid];
          if(!old || (r.updatedAt || 0) >= (old.updatedAt || 0)){
            cur.records[rid] = r;
            merged++;
            /* 恢复过/重建的记录不该再被墓碑卡住：同 id 同步上来时清掉墓碑 */
            cur.deleted = (cur.deleted || []).filter(d => d !== rid);
          }
        }
        remote[key] = cur;
      }
      if(tooLarge(remote)) return {ok: false, code: "too_large", message: "云端数据已满，请先在云端删掉一些内容" };
      await collData.doc(id).set({data: Object.assign({uid: u}, remote), updatedAt: now});
      return {ok: true, merged};

    }else if(action === "pull"){
      const since = Number(body.since) || 0;
      const doc = await getUserDoc(id);
      if(!doc) return {ok: true, data: {}, serverTime: now};
      if((doc.updatedAt || 0) <= since) return {ok: true, data: {}, serverTime: doc.updatedAt || 0};
      /* 只回客户端白名单里的键：库里可能存过别的东西（历史版本 / 手工塞的），
         原样回传等于把服务端数据结构暴露给客户端的合并逻辑。 */
      const data = {};
      Object.keys(doc.data || {}).forEach(k => { data[k] = doc.data[k]; });
      return {ok: true, data, serverTime: doc.updatedAt || now};

    }else if(action === "snapshot"){
      const data = body.data || {};
      if(tooLarge(data)) return {ok: false, code: "too_large", message: "备份内容过大" };
      await db.collection("wb_snapshots").add({
        uid: u, ts: now, tag: String(body.tag || "").slice(0, 30),
        size: JSON.stringify(data).length,
        data,
      });
      // 只留最近 MAX_SNAPSHOTS 份（按 uid 删，不误伤别人的）
      const snaps = (await db.collection("wb_snapshots").where({uid: u})
        .orderBy("ts", "desc").skip(MAX_SNAPSHOTS).limit(100).get()).data;
      for(const s of snaps){ await db.collection("wb_snapshots").doc(s._id).remove(); }
      return {ok: true, ts: now};

    }else if(action === "snapshots"){
      const snaps = (await db.collection("wb_snapshots").where({uid: u})
        .orderBy("ts", "desc").limit(MAX_SNAPSHOTS).get()).data;
      return {ok: true, list: snaps.map(s => ({ts: s.ts, tag: s.tag, size: s.size}))};

    }else if(action === "restore"){
      const ts = Number(body.ts) || 0;
      const snaps = (await db.collection("wb_snapshots").where({uid: u, ts})
        .limit(1).get()).data;
      if(!snaps.length) return {ok: false, message: "快照不存在"};
      return {ok: true, data: snaps[0].data};
    }
    return {ok: false, message: "未知 action"};
  }catch(e){
    /* 对外只给一句人话；细节进日志。之前把 e.message 原样回传，
       会把内部地址与上游响应片段漏给调用方（踩坑 #097）。 */
    console.error("[sync] action=" + action, e);
    return {ok: false, message: "服务异常，请稍后再试"};
  }
};

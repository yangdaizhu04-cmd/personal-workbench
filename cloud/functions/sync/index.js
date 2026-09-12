/* 云函数 sync —— 自动双向同步 + 快照
   action:
    push   {token, data:{key: {records:{id:rec}}, deleted:{key:[id]}}}
    pull   {token, since}  → 远端比 since 新的所有数据
    snapshot {token, data, tag}  手动备份
    snapshots {token}  → 快照列表
    restore  {token, ts} → 读取某快照
   冲突策略：记录级 updatedAt 新者胜（push 时对逐条比较） */
const cloud = require("@cloudbase/node-sdk");
const crypto = require("crypto");

const app = cloud.init({env: cloud.SYMBOL_CURRENT_ENV});
const db = app.database();

function hmac(str){
  return crypto.createHmac("sha256", "wb-gate-salt-2026").update(str).digest("hex").slice(0, 32);
}
function uid(token){
  return "u" + hmac(token).slice(0, 12); // token 即身份（同一密码同一空间）
}

async function getUserDoc(uidv){
  const coll = db.collection("wb_data");
  const rec = (await coll.where({uid: uidv}).limit(1).get()).data[0];
  return rec;
}

exports.main = async function(event){
  const body = typeof event === "string" ? JSON.parse(event || "{}") : (event || {});
  const action = body.action;
  const token = String(body.token || "");
  if(!token) return {ok: false, message: "未登录"};
  const u = uid(token);
  const now = Date.now();

  try{
    if(action === "push"){
      const data = body.data || {}; // {key: {records:{id:rec}}}
      let doc = await getUserDoc(u);
      if(!doc){
        await db.collection("wb_data").add({uid: u, data: {}, updatedAt: now});
        doc = await getUserDoc(u);
      }
      const remote = doc.data || {};
      let merged = 0;
      for(const key of Object.keys(data)){
        const incoming = data[key].records || {};
        const cur = remote[key] || {records: {}};
        for(const id of Object.keys(incoming)){
          const r = incoming[id];
          const old = cur.records[id];
          if(!old || (r.updatedAt || 0) >= (old.updatedAt || 0)){
            cur.records[id] = r;
            merged++;
          }
        }
        remote[key] = cur;
      }
      await db.collection("wb_data").doc(doc._id).update({data: remote, updatedAt: now});
      return {ok: true, merged};

    }else if(action === "pull"){
      const since = body.since || 0;
      const doc = await getUserDoc(u);
      if(!doc) return {ok: true, data: {}, serverTime: now};
      if((doc.updatedAt || 0) <= since) return {ok: true, data: {}, serverTime: doc.updatedAt || 0};
      return {ok: true, data: doc.data || {}, serverTime: doc.updatedAt || now};

    }else if(action === "snapshot"){
      const doc = await getUserDoc(u);
      await db.collection("wb_snapshots").add({
        uid: u, ts: now, tag: String(body.tag || "").slice(0, 30),
        size: JSON.stringify(body.data || {}).length,
        data: body.data || {},
      });
      // 只留最近 30 个快照
      const snaps = (await db.collection("wb_snapshots").where({uid: u})
        .orderBy("ts", "desc").skip(30).limit(100).get()).data;
      for(const s of snaps){ await db.collection("wb_snapshots").doc(s._id).remove(); }
      return {ok: true, ts: now};

    }else if(action === "snapshots"){
      const snaps = (await db.collection("wb_snapshots").where({uid: u})
        .orderBy("ts", "desc").limit(30).get()).data;
      return {ok: true, list: snaps.map(s => ({ts: s.ts, tag: s.tag, size: s.size}))};

    }else if(action === "restore"){
      const snaps = (await db.collection("wb_snapshots").where({uid: u, ts: Number(body.ts) || 0})
        .limit(1).get()).data;
      if(!snaps.length) return {ok: false, message: "快照不存在"};
      return {ok: true, data: snaps[0].data};
    }
    return {ok: false, message: "未知 action"};
  }catch(e){
    return {ok: false, message: "服务异常: " + e.message};
  }
};

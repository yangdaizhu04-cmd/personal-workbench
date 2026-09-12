/* modules/assistant.js —— AI 小助手（云端版）：三按钮 / 对话式数据问答 / 笔记标签建议
   BYOK：支持 GLM / DeepSeek / OpenAI 兼容；不填则用云开发大模型额度
   隐私：使用前明确提示，内容将发送给 AI 服务；设置可整体关闭 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

function byok(){
  const s = WB.store.get("byok", {});
  return {provider: s.aiProvider || "", key: s.aiKey || "", model: s.aiModel || ""};
}
function aiEnabled(){
  return WB.theme.get("aiEnabled") !== false;
}

/* 数据摘要（对话式问答的上下文） */
function dataContext(){
  const days7 = [];
  const today = WB.bizDate();
  for(let i = 6; i >= 0; i--) days7.push(WB.addDaysStr(today, -i));
  const todos = WB.store.get("todos", []);
  const done = todos.filter(t => t.done && days7.includes(t.date)).length;
  const undone = todos.filter(t => !t.done && t.date && t.date <= today).length;
  const focusMin = WB.store.get("pomoLog", []).filter(l => days7.includes(l.date) && l.status === "done" && l.mode === "focus").reduce((s, l) => s + l.minutes, 0);
  const moods = WB.store.get("moods", []).filter(m => days7.includes(m.date));
  const moodAvg = moods.length ? (moods.reduce((s, m) => s + m.level, 0) / moods.length).toFixed(1) : "无";
  const spend = WB.store.get("ledger", []).filter(l => days7.includes(l.date) && l.type === "out").reduce((s, l) => s + l.amount, 0).toFixed(0);
  const habits = WB.store.get("habits", []).filter(h => !h.archived).map(h => h.name + "(" + WB.habits.streakOf(h.id) + "天)").join("、") || "无";
  const journalExcerpts = WB.store.get("journals", [])
    .filter(j => days7.includes(j.date) && (j.free || j.done))
    .slice(-3).map(j => j.date + "：" + (j.free || j.done).slice(0, 50)).join(" / ") || "无";
  return "用户近7天数据：完成任务 " + done + " 件，过期未完成 " + undone + " 件，专注 " + focusMin +
    " 分钟，平均心情 " + moodAvg + "/5，支出 ¥" + spend + "，习惯打卡：" + habits + "。近期日志摘录：" + journalExcerpts;
}

async function ask(messages, onDone){
  if(!aiEnabled()){ WB.ui.toast("AI 功能已在设置中关闭", "warn"); return; }
  const r = await WB.cloud.callProxy({kind: "ai", messages, byok: byok()});
  if(r.ok) onDone(r.text || "");
  else onDone("⚠ " + (r.message || "AI 暂不可用"));
}

/* ---------- 主界面 ---------- */
function render(view){
  const warn = WB.store.get("aiNoticeAck", false);
  const wrap = el("div", {class: "col", style: {gap: "14px"}});

  /* 三按钮 */
  const quick = el("div", {class: "grid grid-3"});
  [["周报解读", "gift", "解读本周报告，给出下周建议"], ["日记回应", "book", "温柔地回应你最近写下的日志"], ["复盘整理", "grid", "把这一周整理成三行复盘"]].forEach(([label, ic, hint]) => {
    quick.appendChild(el("button", {class: "card hoverable center col", style: {padding: "18px", gap: "6px", cursor: "pointer"},
      onclick: () => quickRun(label),
      html: icon(ic, 22) + "<b style='font-size:15px'>" + label + "</b><span class='small faint'>" + hint + "</span>"}));
  });
  wrap.appendChild(quick);

  /* 对话区 */
  const chatCard = el("div", {class: "card"});
  chatCard.appendChild(el("div", {class: "card-title", html: icon("sparkle", 18) + "<span>对话式助手</span><span class='card-sub'>会自动查看你的近期数据后回答</span>"}));
  const log = el("div", {id: "ai-log", class: "col", style: {gap: "10px", maxHeight: "46vh", overflowY: "auto", padding: "4px 2px"}});
  chatCard.appendChild(log);
  const row = el("div", {class: "row", style: {marginTop: "10px"}});
  const input = el("input", {class: "input grow", placeholder: "问问它：我这周状态怎么样？哪类任务总拖延？"});
  const sendBtn = el("button", {class: "btn primary sm", html: icon("send", 14) + "<span>发送</span>"});
  row.appendChild(input); row.appendChild(sendBtn);
  chatCard.appendChild(row);
  wrap.appendChild(chatCard);

  /* 标签建议 */
  const tagCard = el("div", {class: "card"});
  tagCard.appendChild(el("div", {class: "card-title", html: icon("tag", 18) + "<span>笔记自动标签建议</span>"}));
  const tagBtn = el("button", {class: "btn sm", text: "为最近 5 条没有标签的笔记建议标签",
    onclick: async () => {
      const target = WB.store.get("notes", []).filter(n => !(n.tags || []).length).slice(-5);
      if(!target.length){ WB.ui.toast("所有笔记都有标签啦"); return; }
      tagBtn.disabled = true; tagBtn.textContent = "分析中…";
      for(const n of target){
        const r = await WB.cloud.callProxy({kind: "ai", byok: byok(), messages: [
          {role: "system", content: "给笔记建议 2-3 个简短中文标签，只输出标签，用逗号分隔，不要其他内容"},
          {role: "user", content: n.content.slice(0, 500)},
        ]});
        if(r.ok && r.text){
          const tags = String(r.text).replace(/#/g, "").split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 3);
          WB.collection("notes").update(n.id, {tags: [...new Set(tags)]});
        }
      }
      tagBtn.disabled = false; tagBtn.textContent = "为最近 5 条没有标签的笔记建议标签";
      WB.ui.toast("标签已建议，去笔记页看看");
      WB.router.render();
    }});
  tagCard.appendChild(tagBtn);
  wrap.appendChild(tagCard);
  view.appendChild(wrap);

  let history = [];
  function bubble(role, text){
    const b = el("div", {style: {maxWidth: "86%", padding: "10px 14px", borderRadius: "16px", fontSize: "14px", lineHeight: 1.9,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
      background: role === "user" ? "var(--accent-soft)" : "var(--card-2)",
      alignSelf: role === "user" ? "flex-end" : "flex-start"}});
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  async function send(){
    const q = input.value.trim();
    if(!q) return;
    input.value = "";
    bubble("user", q);
    const thinking = bubble("ai", "思考中…");
    history.push({role: "user", content: q});
    ask([
      {role: "system", content: "你是一个温柔、简洁的个人效率助手，内嵌在用户的工作台里。用中文回答，口语化、有温度、不啰嗦。以下是用户的近期数据，回答时直接引用：" + dataContext()},
      ...history.slice(-8),
    ], text => {
      thinking.textContent = text;
      history.push({role: "assistant", content: text});
      log.scrollTop = log.scrollHeight;
    });
  }
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", e => { if(e.key === "Enter") send(); });

  function quickRun(kind){
    const prompts = {
      "周报解读": "请解读我本周的状态报告，指出亮点与一个最值得改进的点，并给出下周的一个具体建议。",
      "日记回应": "读一读我近期的日志摘录，像一个老朋友一样温柔地回应我，指出我可能没注意到的小情绪或小进步。",
      "复盘整理": "把我这一周的数据整理成三行复盘：做得好的 / 待改进的 / 下周只做的一件事。",
    };
    const thinking = bubble("ai", kind + "生成中…");
    ask([
      {role: "system", content: "你是用户工作台里的 AI 助手，用中文回复，简洁有温度。用户数据：" + dataContext()},
      {role: "user", content: prompts[kind]},
    ], text => { thinking.textContent = text; log.scrollTop = log.scrollHeight; });
  }
}

WB.registerModule({
  id: "assistant",
  title: "AI 助手",
  icon: "sparkle",
  sub: () => aiEnabled() ? "周报解读 · 日记回应 · 复盘整理" : "已在设置中关闭",
  render(view){
    if(!WB.cloud.available || !WB.cloud.available()){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("sparkle", "AI 助手（云端版功能）",
        "部署到云端后可用：周报解读 / 日记回应 / 复盘整理 / 对话式数据问答 / 笔记自动标签。<br>本地版一切照常，数据仍只存本机。")));
      return;
    }
    if(!WB.store.get("aiNoticeAck", false)){
      const box = el("div", {class: "card", style: {marginBottom: "14px", background: "var(--accent2-soft)", border: "none"}},
        el("div", {style: {fontWeight: "600", marginBottom: "6px"}}, "🔒 使用前请知悉"),
        el("div", {class: "small muted", style: {lineHeight: 2}},
          "AI 功能会把你的部分数据（近期任务摘要 / 日志摘录）发送给 AI 服务用于生成回答。", el("br"),
          "密钥仅存本机；可在设置里随时整体关闭 AI。"),
        el("button", {class: "btn primary sm", style: {marginTop: "10px"}, text: "我知道了，开启 AI",
          onclick: () => { WB.store.set("aiNoticeAck", true); WB.router.render(); }}));
      view.appendChild(box);
    }
    render(view);
  },
});
WB.assistant = {render};
})();

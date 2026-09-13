/* modules/settings.js —— 设置：主题/动效/番茄/提醒/数据管理/快捷键/关于 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;

WB.registerModule({
  id: "settings",
  title: "设置",
  icon: "settings",
  sub: () => "偏好与数据都在这里",
  render(view){
    const s = WB.theme.all();

    const wrap = el("div", {class: "grid", style: {gridTemplateColumns: "1fr", gap: "16px"}});

    /* --- 外观 --- */
    const accentRow = el("div", {class: "row", style: {gap: "10px", flexWrap: "wrap"}});
    const accents = [
      ["mist", "雾蓝淡紫"], ["peach", "蜜桃鹅黄"], ["mint", "薄荷奶咖"], ["custom", "自定义"],
    ];
    accents.forEach(([id, label]) => {
      const on = (id === "custom" ? s.accent === "custom" : s.accent === id) || (id !== "custom" && s.accent === id);
      accentRow.appendChild(el("button", {
        class: "chip clickable" + (s.accent === id ? "" : " plain"),
        text: label,
        onclick: () => { WB.theme.set("accent", id); WB.router.render(); },
      }));
    });
    const colorInput = el("input", {type: "color", value: s.accentCustom || "#7fa3bd",
      style: {width: "42px", height: "30px", padding: "0", border: "none", background: "none", cursor: "pointer"}});
    colorInput.addEventListener("input", () => {
      WB.theme.merge({accent: "custom", accentCustom: colorInput.value});
    });
    accentRow.appendChild(colorInput);

    wrap.appendChild(sectionCard("palette", "外观", [
      row("深浅色", "夜雾模式更护眼，快捷键 D 切换",
        seg([["light", "晨雾奶油"], ["dark", "夜雾"], ["auto", "跟随系统"]], s.theme, v => WB.theme.set("theme", v))),
      row("点缀色", "三套预设 + 自定义强调色", accentRow),
      row("静音动效", "一键关闭所有动画与音效",
        toggle(s.motion, v => WB.theme.set("motion", v))),
      row("背景", "光斑 / 动态晨露夜雾 / Bing 每日 / 自定义图片",
        seg([["blobs", "光斑"], ["dynamic", "动态"], ["bing", "Bing"], ["custom", "自定义"]],
          WB.theme.bgMode(), v => WB.theme.set("bgMode", v))),
      row("自定义图片", "上传图片或用 Unsplash（需在下方 BYOK 填 Key），上传后自动启用", bgEditor()),
    ]));

    /* --- 番茄钟与提醒 --- */
    wrap.appendChild(sectionCard("timer", "番茄钟与提醒", [
      rowNum("专注时长（分钟）", s.pomodoroFocus, v => WB.theme.set("pomodoroFocus", v), 5, 180),
      rowNum("休息时长（分钟）", s.pomodoroRest, v => WB.theme.set("pomodoroRest", v), 1, 60),
      row("完成响铃", "合成铃声（无音频文件）", toggle(s.pomoSound, v => WB.theme.set("pomoSound", v))),
      row("全屏提示动画", "番茄结束时页面内温柔提示", toggle(s.pomoFlash, v => WB.theme.set("pomoFlash", v))),
      row("标签页标题闪烁", "切到别的标签页也不会错过", toggle(s.pomoTitle, v => WB.theme.set("pomoTitle", v))),
      rowNum("收工按钮出现时间（点）", s.offworkHour, v => WB.theme.set("offworkHour", v), 0, 23),
      rowNum("生日提前提醒（天）", s.birthdayAhead, v => WB.theme.set("birthdayAhead", v), 0, 30),
    ]));

    /* --- 天气与内容 --- */
    const cityInput = el("input", {class: "input", value: s.weatherCity || "",
      placeholder: "留空自动定位；填城市拼音如 beijing"});
    cityInput.addEventListener("change", () => WB.theme.set("weatherCity", cityInput.value.trim()));
    wrap.appendChild(sectionCard("cloud", "天气与内容源", [
      row("天气城市", "手动覆盖 IP 定位", cityInput),
      row("每日一句来源", "断网自动回落内置语录",
        seg([["hitokoto", "一言"], ["jinrishici", "今日诗词"], ["builtin", "内置双语"]], s.quoteSource, v => WB.theme.set("quoteSource", v))),
      row("汇率货币", "美/欧/日/港→人民币，可增删", currenciesEditor(s.currencies)),
    ]));

    /* --- 数据管理 --- */
    wrap.appendChild(sectionCard("archive", "数据管理", [
      row("备份", "导出全部数据为 JSON 文件",
        el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 JSON</span>",
          onclick: () => {
            const data = WB.store.exportAll();
            data.__meta = {app: "个人工作台", version: 1, exportedAt: new Date().toISOString()};
            WB.downloadFile("个人工作台备份-" + WB.todayStr() + ".json", JSON.stringify(data, null, 2), "application/json");
            WB.ui.toast("已导出 " + Object.keys(data).length + " 类数据");
          }})),
      row("恢复", "从 JSON 备份导入（合并或覆盖）", importBtn()),
      row("日志笔记", "导出为 Markdown 文件", el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 MD</span>",
        onclick: () => WB.exports && WB.exports.journals()})),
      row("账单", "导出为 CSV 表格", el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 CSV</span>",
        onclick: () => WB.exports && WB.exports.ledger()})),
    ]));

    /* --- BYOK 我的密钥 --- */
    const byokS = WB.store.get("byok", {});
    const byokField = (label, key, placeholder, type) => {
      const input = el("input", {class: "input", type: type || "text", value: byokS[key] || "",
        placeholder, style: {maxWidth: "320px"}});
      input.addEventListener("change", () => {
        const b = WB.store.get("byok", {});
        b[key] = input.value.trim();
        WB.store.set("byok", b);
        WB.ui.toast("已保存（仅存本机）");
      });
      return row(label, "", input);
    };
    const aiProvSeg = el("div", {class: "seg"});
    [["", "不填（用云开发额度）"], ["glm", "智谱 GLM"], ["deepseek", "DeepSeek"], ["openai", "OpenAI 兼容"]].forEach(([v, l]) => {
      aiProvSeg.appendChild(el("button", {class: (byokS.aiProvider || "") === v ? "on" : "", text: l,
        onclick: () => {
          const b = WB.store.get("byok", {});
          b.aiProvider = v;
          WB.store.set("byok", b);
          WB.router.render();
        }}));
    });
    wrap.appendChild(sectionCard("key", "BYOK 我的密钥", [
      el("div", {class: "small muted", style: {marginBottom: "8px"}, text: "密钥只存在你的浏览器本地，请求时随用随传，不经过其他服务器。不填则使用免费方案。"}),
      row("AI 服务商", "对话/标签建议用", aiProvSeg),
      byokField("AI Key", "aiKey", "粘贴你的 API Key（sk-… / id.secret…）", "password"),
      byokField("AI 模型", "aiModel", "留空用默认（glm-4-flash / deepseek-chat）"),
      byokField("Unsplash Key", "unsplash", "换背景图用（申请：unsplash.com/developers）", "password"),
    ]));

    /* --- 云端备份（仅云端版） --- */
    const cloudCard = sectionCard("cloud", "云端备份", []);
    if(WB.cloud && WB.cloud.available && WB.cloud.available()){
      cloudCard.appendChild(row("备份到云", "重要节点手动存档（每日另有自动快照）",
        el("button", {class: "btn sm primary", text: "立即备份", onclick: () => WB.cloud.manualBackup()})));
      const listBox = el("div", {class: "small muted", style: {padding: "4px 0"}, text: "加载快照列表…"});
      cloudCard.appendChild(listBox);
      WB.cloud.listSnapshots().then(list => {
        listBox.innerHTML = "";
        if(!list.length){ listBox.textContent = "还没有快照"; return; }
        list.slice(0, 10).forEach(s => {
          listBox.appendChild(el("div", {class: "row", style: {padding: "6px 0", borderTop: "1px dashed var(--card-border)"}},
            el("span", {class: "grow small", text: new Date(s.ts).toLocaleString() + (s.tag ? " · " + s.tag : "")}),
            el("button", {class: "btn sm danger", text: "恢复此版本",
              onclick: async () => {
                const ok = await WB.ui.confirmBox("用这个快照<b>覆盖</b>当前本地数据？", {danger: true, okLabel: "覆盖恢复"});
                if(ok) WB.cloud.restoreSnapshot(s.ts);
              }})));
        });
      });
    }else{
      cloudCard.appendChild(el("div", {class: "small faint", text: "云端版可用：自动双向同步 + 每日快照 + 手动备份。本地双击版请用 JSON 导出备份。"}));
    }
    wrap.appendChild(cloudCard);

    /* --- 通知 --- */
    wrap.appendChild(sectionCard("bell", "系统通知", [
      row("浏览器通知", "待办到点提醒（页面开着时生效）", notifyBtn()),
    ]));

    /* --- 快捷键 --- */
    wrap.appendChild(sectionCard("zap", "键盘快捷键", [
      hotkeyRow("Ctrl + K", "万能命令面板（捕捉/跳转/翻译/搜索）"),
      hotkeyRow("N", "新笔记"),
      hotkeyRow("T", "新任务"),
      hotkeyRow("空格", "声音面板 播放/暂停（番茄页）"),
      hotkeyRow("D", "切换深浅色"),
      hotkeyRow("Esc", "关闭弹窗/面板"),
    ]));

    /* --- 关于 --- */
    wrap.appendChild(sectionCard("heart", "关于", [
      el("div", {class: "small muted", html:
        "个人工作台 · 晨雾奶油 —— 为「每天与自己对话」而生。<br>数据仅存于本机浏览器（localStorage + IndexedDB），导出即带走。<br>内置开源组件：霞鹜文楷（SIL OFL）、ECharts（Apache-2.0）、GSAP（Standard License，本地使用）、solarlunar（MIT）、qrcode-generator（MIT）。"}),
    ]));

    view.appendChild(wrap);

    /* ---------- 小部件 ---------- */
    function sectionCard(ic, title, children){
      return el("div", {class: "card"},
        el("div", {class: "card-title", html: icon(ic, 18) + "<span>" + title + "</span>"}),
        ...children);
    }
    function row(label, hint, control){
      return el("div", {class: "row", style: {padding: "9px 0", borderTop: "1px dashed var(--card-border)", alignItems: "center"}},
        el("div", {class: "grow"},
          el("div", {text: label, style: {fontSize: "14.5px"}}),
          hint ? el("div", {class: "small faint", text: hint}) : null),
        control);
    }
    function rowNum(label, val, onSet, min, max){
      const input = el("input", {type: "number", class: "input", value: val, min, max,
        style: {width: "86px", textAlign: "center"}});
      input.addEventListener("change", () => {
        const v = WB.clamp(parseInt(input.value) || min, min, max);
        input.value = v; onSet(v);
      });
      return row(label, "", input);
    }
    function toggle(on, onSet){
      const lab = el("label", {class: "switch"});
      const input = el("input", {type: "checkbox"});
      input.checked = !!on;
      input.addEventListener("change", () => onSet(input.checked));
      lab.appendChild(input);
      lab.appendChild(el("span", {class: "track"}));
      lab.appendChild(el("span", {class: "thumb"}));
      return lab;
    }
    function seg(items, cur, onSet){
      const box = el("div", {class: "seg"});
      items.forEach(([v, label]) => {
        box.appendChild(el("button", {
          class: v === cur ? "on" : "", text: label,
          onclick: () => { onSet(v); WB.router.render(); },
        }));
      });
      return box;
    }
    function currenciesEditor(list){
      const box = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px", justifyContent: "flex-end"}});
      const render = () => {
        box.innerHTML = "";
        (list || []).forEach(c => {
          box.appendChild(el("span", {class: "chip plain"},
            el("span", {text: c + "→CNY"}),
            el("button", {html: icon("close", 11), style: {display: "flex", opacity: .6},
              onclick: () => { list = list.filter(x => x !== c); WB.theme.set("currencies", list); render(); }})));
        });
        const input = el("input", {placeholder: "代码", style: {width: "58px", padding: "3px 8px", fontSize: "12px"}});
        input.addEventListener("keydown", e => {
          if(e.key === "Enter"){
            const c = input.value.trim().toUpperCase();
            if(c && /^[A-Z]{3}$/.test(c) && !list.includes(c)){
              list = list.concat(c); WB.theme.set("currencies", list); render();
            }
          }
        });
        box.appendChild(input);
      };
      render();
      return box;
    }
    function bgEditor(){
      const box = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap", justifyContent: "flex-end"}});
      const file = el("input", {type: "file", accept: "image/*", style: {display: "none"}});
      file.addEventListener("change", async () => {
        if(!file.files[0]) return;
        try{
          const blob = await WB.idb.compressImage(file.files[0], 1600, 0.8);
          const reader = new FileReader();
          reader.onload = () => {
            WB.theme.set("themeCustomBg", reader.result);
            WB.theme.set("bgMode", "custom");
            WB.ui.toast("背景已更换");
          };
          reader.readAsDataURL(blob);
        }catch(err){ WB.ui.toast("图片处理失败", "warn"); }
      });
      box.appendChild(file);
      box.appendChild(el("button", {class: "btn sm", html: icon("upload", 14) + "<span>上传</span>", onclick: () => file.click()}));
      const q = el("input", {class: "input", placeholder: "Unsplash 关键词", style: {width: "130px"}});
      box.appendChild(q);
      box.appendChild(el("button", {class: "btn sm", html: icon("image", 14) + "<span>Unsplash 搜图</span>",
        onclick: async () => {
          const key = (WB.store.get("byok", {}).unsplash) || "";
          if(!key){ WB.ui.toast("请先在「BYOK 我的密钥」里填 Unsplash Key", "warn"); return; }
          const query = q.value.trim() || "nature";
          WB.ui.toast("搜图中…");
          const d = await WB.net.getJSON("https://api.unsplash.com/search/photos?query=" + encodeURIComponent(query) +
            "&per_page=1&orientation=landscape&client_id=" + key, {timeout: 9000});
          const url = d && d.results && d.results[0] && (d.results[0].urls.regular || d.results[0].urls.full);
          if(url){
            WB.theme.set("themeCustomBg", url);
            WB.theme.set("bgMode", "custom");
            WB.ui.toast("背景已更换（Unsplash）");
          }else WB.ui.toast("Unsplash 暂不可用，检查 Key 或网络", "warn");
        }}));
      box.appendChild(el("button", {class: "btn sm ghost", text: "恢复默认",
        onclick: () => { WB.theme.set("themeCustomBg", ""); WB.theme.set("bgMode", "blobs"); WB.ui.toast("已恢复奶油风"); }}));
      return box;
    }
    function notifyBtn(){
      const btn = el("button", {class: "btn sm"});
      const upd = () => {
        const p = ("Notification" in window) ? Notification.permission : "unsupported";
        btn.textContent = p === "granted" ? "已授权 ✓" : p === "denied" ? "已被拒绝" : p === "unsupported" ? "浏览器不支持" : "点击授权";
        btn.disabled = p !== "default";
      };
      btn.addEventListener("click", async () => {
        await WB.ensureNotifyPermission(); upd();
        if(Notification.permission === "granted") WB.ui.toast("通知已开启，到点会提醒你");
      });
      upd();
      return btn;
    }
    function hotkeyRow(key, desc){
      return el("div", {class: "row", style: {padding: "6px 0"}},
        el("span", {class: "chip plain", text: key, style: {minWidth: "86px", justifyContent: "center"}}),
        el("span", {class: "small muted", text: desc}));
    }
    function importBtn(){
      const file = el("input", {type: "file", accept: ".json", style: {display: "none"}});
      file.addEventListener("change", async () => {
        const f = file.files[0]; if(!f) return;
        try{
          const text = await f.text();
          const data = JSON.parse(text);
          if(!data || typeof data !== "object" || !data.settings) throw new Error("不是有效的备份文件");
          const overwrite = await WB.ui.confirmBox(
            "选择导入方式：<br><b>合并</b>：云端/备份的数据并入本地，重复记录去重。<br><b>覆盖</b>：清空本地后完全使用备份。",
            {title: "导入备份", okLabel: "合并导入"});
          if(!overwrite){
            WB.store.importAll(data, {merge: false}); // 覆盖
          }else{
            WB.store.importAll(data, {merge: true});
          }
          WB.ui.toast("导入完成，正在刷新…");
          setTimeout(() => location.reload(), 900);
        }catch(err){
          WB.ui.toast("导入失败：" + err.message, "warn");
        }
      });
      const btn = el("button", {class: "btn sm", html: icon("upload", 15) + "<span>导入 JSON</span>",
        onclick: () => file.click()});
      btn.appendChild(file);
      return btn;
    }
  },
});
})();

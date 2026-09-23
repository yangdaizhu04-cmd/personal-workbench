/* modules/settings.js —— 设置：主题/动效/番茄/提醒/数据管理/WebDAV/快捷键/关于 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon } = WB;

/* ---- WebDAV 同步引擎（浏览器直连，Basic 认证；目录不存在时先 MKCOL 再重试一次） ---- */
const WBDAV_FILE = "personal-workbench-backup.json";
function wdBase(){
  const c = WB.store.get("webdav", {});
  let u = (c.url || "").trim();
  if(!u) return null;
  if(!/^https?:\/\//i.test(u)) u = "https://" + u;
  return {base: u.endsWith("/") ? u : u + "/", c};
}
function wdHeaders(c){
  return {"Authorization": "Basic " + btoa(unescape(encodeURIComponent(c.user + ":" + c.pass)))};
}
async function wdPut(base, c, body){
  const opts = {method: "PUT", headers: Object.assign({"Content-Type": "application/json"}, wdHeaders(c)), body};
  let res = await fetch(base.base + WBDAV_FILE, opts);
  if((res.status === 404 || res.status === 409) && !base._mkcol){
    base._mkcol = true;
    await fetch(base.base, {method: "MKCOL", headers: wdHeaders(c)}).catch(() => {});
    res = await fetch(base.base + WBDAV_FILE, opts);
  }
  return res;
}
/* 快照口径：剔除 webdav* 自身键；哈希只算数据体（__meta.exportedAt 每次都变，参与即永远"有变化"） */
function webdavData(){
  const data = WB.store.exportAll();
  Object.keys(data).forEach(k => { if(k.startsWith("webdav")) delete data[k]; });
  return data;
}
function webdavSnapshot(){
  const data = webdavData();
  return JSON.stringify(Object.assign(data, {__meta: {app: "个人工作台", version: 1, exportedAt: new Date().toISOString()}}), null, 2);
}
function webdavDataHash(){
  return webdavHash(JSON.stringify(webdavData()));
}
WB.webdav = {
  async upload(){
    const base = wdBase();
    if(!base) return {ok: false, err: "先填服务器目录"};
    if(!base.c.user || !base.c.pass) return {ok: false, err: "先填账号与应用密码"};
    try{
      const body = webdavSnapshot();
      const res = await wdPut(base, base.c, body);
      if(!res.ok) return {ok: false, err: "HTTP " + res.status + (res.status === 0 ? "（跨域被拦截或网络不通）" : "")};
      WB.store.set("webdavLastHash", webdavDataHash());
      WB.store.set("webdavLastPush", Date.now());
      return {ok: true, kb: Math.round(body.length / 1024)};
    }catch(e){ return {ok: false, err: e.message + "（跨域被拦截或网络不通）"}; }
  },
  async pull(){
    const base = wdBase();
    if(!base) return {ok: false, err: "先填服务器目录"};
    try{
      const res = await fetch(base.base + WBDAV_FILE, {headers: wdHeaders(base.c)});
      if(!res.ok) return {ok: false, err: "HTTP " + res.status + "（没有备份或目录不对）"};
      const data = JSON.parse(await res.text());
      if(!data || typeof data !== "object" || !data.settings) return {ok: false, err: "文件不是本应用的备份"};
      return {ok: true, data};
    }catch(e){ return {ok: false, err: e.message + "（跨域被拦截或网络不通）"}; }
  },
  hashNow(){ return webdavDataHash(); },   // 调试/探针用：当前数据体哈希
  /* 每天首次打开且数据有变化时静默上传一次（30s 后执行，避开启动竞争） */
  async autoCheck(){
    const c = WB.store.get("webdav", {});
    if(!c.auto || !c.url) return;
    const today = WB.bizDate();
    if(WB.store.get("webdavAuto:" + today, false)) return;
    const body = webdavSnapshot();
    if(webdavDataHash() === WB.store.get("webdavLastHash", "")) return;
    const base = wdBase();
    const res = await wdPut(base, c, body);
    if(res.ok){
      WB.store.set("webdavAuto:" + today, true);
      WB.store.set("webdavLastHash", webdavDataHash());
      WB.ui.toast("已自动备份到 WebDAV ✦");
    }
  },
};
function webdavHash(str){   // djb2：够用来判断"数据变没变"
  let h = 5381;
  for(let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h);
}
setTimeout(() => { WB.webdav.autoCheck().catch(e => console.error("[webdav]", e)); }, 30000);


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
    /* 松手（change）才重绘：「自定义」chip 要亮起来，但拖动过程里 input 是高频事件，
       逐帧重建整页会卡，所以拖拽期间只改主题、不重建 */
    colorInput.addEventListener("change", () => WB.router.render());
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
      cssEditor(),
    ]));

    /* --- 氛围编排（js/17-ambience.js）：按时段自动编排 场景 / 音景 / 主题 ---
       引擎默认关闭；这里是唯一的确认入口与唯一的搭配入口。
       下拉用原生 select（十二个场景用分段控件会撑爆一行），样式走已有的 select.input */
    const AMB = WB.ambience;
    if(AMB){
      const amb = AMB.plan();
      const nowSeg = AMB.currentSeg();
      const ambRows = [];

      const pickSel = (items, cur, onSet) => {
        const sel = el("select", {class: "input",
          style: {width: "auto", minWidth: "92px", padding: "5px 8px", fontSize: "13px"}});
        items.forEach(([v, l]) => sel.appendChild(el("option", {value: v, text: l})));
        sel.value = cur;
        sel.addEventListener("change", () => onSet(sel.value));
        return sel;
      };
      const sceneOpts = [["off", "不干预"]].concat(
        (WB.immersive && WB.immersive.order ? WB.immersive.order : [])
          .map(id => [id, WB.immersive.scenes[id]]));
      const soundOpts = [["off", "无"]].concat(AMB.SOUND_KEYS);
      const themeOpts = [["light", "晨雾奶油"], ["dark", "夜雾"], ["auto", "跟随系统"]];

      /* 首次进来问一次（不是弹窗：不打断，也不进 modal 栈） */
      if(!s.ambienceAsked){
        ambRows.push(el("div", {class: "row",
          style: {gap: "10px", alignItems: "center", padding: "10px 0", flexWrap: "wrap"}},
          el("div", {class: "grow"},
            el("div", {text: "让工作台跟着一天走？", style: {fontSize: "14.5px"}}),
            el("div", {class: "small faint", text: "打开后场景、音景、主题按时段自动切换（下面每一格都能自己改）。不点它，它一次都不会动你的界面"})),
          el("button", {class: "btn sm primary", text: "启用跟随节律",
            onclick: () => { WB.theme.merge({ambienceOn: true, ambienceAsked: true}); AMB.apply(true); WB.router.render(); }}),
          el("button", {class: "btn sm ghost", text: "先不用",
            onclick: () => { WB.theme.set("ambienceAsked", true); WB.router.render(); }})));
      }

      ambRows.push(row("跟随节律", "按时段自动编排下面的搭配（场景用在沉浸专注层：进专注后按 F）；关掉就一切照旧，手动开关完全不受影响",
        toggle(s.ambienceOn, v => {
          WB.theme.set("ambienceOn", v);
          if(v){ if(!s.ambienceAsked) WB.theme.set("ambienceAsked", true); AMB.apply(true); }
          WB.router.render();
        })));

      AMB.SEGS.forEach(seg => {
        const c = amb[seg.id];
        const isNow = seg.id === nowSeg.id;
        const r = row(seg.name + " " + AMB.timeLabel(seg) + (isNow ? " · 当前" : ""),
          isNow ? AMB.describe(seg.id) : "",
          el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap", alignItems: "center"}},
            pickSel(sceneOpts, c.scene, v => { AMB.setSeg(seg.id, {scene: v}); WB.router.render(); }),
            pickSel(soundOpts, c.sound, v => { AMB.setSeg(seg.id, {sound: v}); WB.router.render(); }),
            pickSel(themeOpts, c.theme, v => { AMB.setSeg(seg.id, {theme: v}); WB.router.render(); })));
        r.classList.add("amb-row");   // 窄屏换行规则见 main.css（否则标签列被三个下拉挤成竖条）
        ambRows.push(r);
      });

      ambRows.push(el("div", {class: "small faint", style: {padding: "8px 0 0"}},
        AMB.soundReady()
          ? "音景在时段切换时会替换成上面那一格（你手动调的多路混音会被它覆盖；选「无」则本时段不放）。本地音乐与我的音频库不受影响"
          : "音景要等你手动播放过一次声音之后才会自动切 —— 浏览器不允许页面自己起播音频；在那之前只切场景与主题"));

      ambRows.push(el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap", paddingTop: "10px"}},
        el("button", {class: "btn sm", text: "立即应用当前时段", onclick: () => {
          const r = AMB.apply(true);
          WB.ui.toast(r ? "已切到「" + nowSeg.name + "」：" + AMB.describe(nowSeg.id) : "先打开「跟随节律」开关");
        }}),
        el("button", {class: "btn sm ghost", text: "恢复默认编排", onclick: () => {
          AMB.resetPlan(); WB.router.render(); WB.ui.toast("已恢复默认编排");
        }})));

      wrap.appendChild(sectionCard("sparkle", "氛围编排", ambRows));
    }

    /* --- 番茄钟与提醒 --- */
    wrap.appendChild(sectionCard("timer", "番茄钟与提醒", [
      rowNum("专注时长（分钟）", s.pomodoroFocus, v => WB.theme.set("pomodoroFocus", v), 5, 180),
      rowNum("休息时长（分钟）", s.pomodoroRest, v => WB.theme.set("pomodoroRest", v), 1, 60),
      row("完成响铃", "合成铃声（无音频文件）", toggle(s.pomoSound, v => WB.theme.set("pomoSound", v))),
      row("全屏提示动画", "番茄结束时页面内温柔提示", toggle(s.pomoFlash, v => WB.theme.set("pomoFlash", v))),
      row("待办到点提示", "没有系统通知权限时，页面内弹一条提醒", toggle(s.remindToast, v => WB.theme.set("remindToast", v))),
      row("标签页标题闪烁", "切到别的标签页也不会错过", toggle(s.pomoTitle, v => WB.theme.set("pomoTitle", v))),
      row("沉浸专注", "全屏专注层：细线环 + 巨型数字 + 场景底色 + 环境音联动（快捷键 F）",
        toggle(s.pomoImmersive, v => WB.theme.set("pomoImmersive", v))),
      row("开始专注时自动进入", "默认手动：点计时卡「沉浸」或按 F 进入",
        toggle(s.pomoImmersiveAuto, v => WB.theme.set("pomoImmersiveAuto", v))),
      row("沉浸场景", "十二套配色（经典四景 + 世界风光八景）；开着动态壁纸时透出壁纸，只铺一层压暗面",
        seg([["mist", "晨雾"], ["deep", "深海"], ["ember", "篝火"], ["star", "星野"],
          ["snow", "雪山"], ["lake", "湖泊"], ["sea", "碧海"], ["meadow", "草甸"],
          ["dune", "沙丘"], ["glade", "林间"], ["fall", "飞瀑"], ["cloud", "云海"]],
          s.pomoImmersiveScene, v => WB.theme.set("pomoImmersiveScene", v), "grid-4")),
      row("进入时真全屏", "请求浏览器全屏；被拒也能用，只是不占满屏幕",
        toggle(s.pomoImmersiveFull, v => WB.theme.set("pomoImmersiveFull", v))),
      row("引导", "开始前 3-2-1 准备、休息时 4-7-8 呼吸引导、静止 3 秒自动隐藏控件",
        toggle(s.pomoImmersiveGuide, v => WB.theme.set("pomoImmersiveGuide", v))),
      row("视频背景", "十二支 1080p 循环短片（共约 39MB，仅沉浸时加载、退出即释放）；单文件版与「静音动效」下自动改用纯 CSS 场景",
        toggle(s.pomoImmersiveVideo, v => WB.theme.set("pomoImmersiveVideo", v))),
      row("专注时压低环境音", "专注运行中把环境音降到约 55%，休息与结束后恢复",
        toggle(s.pomoSoundDuck, v => WB.theme.set("pomoSoundDuck", v))),
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
    const snapBox = el("div", {class: "col", style: {gap: "6px", width: "100%"}});
    const paintSnaps = async () => {
      snapBox.innerHTML = "";
      const snaps = WB.snapshots ? await WB.snapshots.list() : [];
      if(!snaps.length){
        snapBox.appendChild(el("div", {class: "small faint", text: "暂无快照，点右侧「立即快照」生成第一份"}));
        return;
      }
      snaps.forEach(sn => {
        snapBox.appendChild(el("div", {class: "row", style: {gap: "6px"}},
          el("span", {class: "small", text: sn.date}),
          el("span", {class: "small faint", text: (sn.label === "auto" ? "自动" : sn.label) + " · " + (sn.bytes / 1024).toFixed(0) + " KB"}),
          el("span", {class: "grow"}),
          el("button", {class: "btn sm", text: "恢复", onclick: async () => {
            if(await WB.snapshots.restore(sn.key)) WB.ui.toast("正在恢复…");
          }}),
          el("button", {class: "btn sm ghost", text: "删除", onclick: async () => {
            if(await WB.ui.confirmBox("删除 " + sn.date + " 的快照？", {danger: true, okLabel: "删除"})){
              await WB.snapshots.remove(sn.key); paintSnaps();
            }}})));
      });
    };
    paintSnaps();
    wrap.appendChild(sectionCard("archive", "数据管理", [
      row("本机快照", "每日自动拍全量快照存 IndexedDB（保留 7 份）；换浏览器/清缓存后可从此恢复",
        el("button", {class: "btn sm", html: icon("archive", 15) + "<span>立即快照</span>",
          onclick: async () => { const r = await WB.snapshots.take("手动"); WB.ui.toast("快照完成（" + (r.bytes / 1024).toFixed(0) + " KB）"); paintSnaps(); }})),
      el("div", {class: "row", style: {alignItems: "flex-start"}}, snapBox),
      row("备份", "导出全部数据为 JSON 文件（快照只在浏览器里，文件备份才是双保险）",
        el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 JSON</span>",
          onclick: () => {
            const data = WB.store.exportAll();
            data.__meta = {app: "个人工作台", version: 1, exportedAt: new Date().toISOString()};
            WB.downloadFile("个人工作台备份-" + WB.todayStr() + ".json", JSON.stringify(data, null, 2), "application/json");
            WB.theme.set("lastExportTs", Date.now());
            WB.ui.toast("已导出 " + Object.keys(data).length + " 类数据");
          }})),
      row("恢复", "从 JSON 备份导入（合并或覆盖）", importBtn()),
      row("配置分享", "导出外观偏好、清单与奖励商店等配置（不含日记账单），朋友导入即得同款框架",
        el("button", {class: "btn sm", html: icon("share", 15) + "<span>导出配置</span>",
          onclick: () => {
            const s = WB.store.get("settings", {}), u = WB.store.get("uiPrefs", {});
            const share = {__share: 1, exportedAt: new Date().toISOString(),
              settings: {theme: s.theme, accent: s.accent, accentCustom: s.accentCustom, quoteSource: s.quoteSource,
                currencies: s.currencies, weatherCity: s.weatherCity, offworkHour: s.offworkHour, birthdayAhead: s.birthdayAhead},
              uiPrefs: {todayCards: u.todayCards, todayExpanded: u.todayExpanded, todayMinimal: u.todayMinimal},
              coinRewards: WB.store.get("coinRewards", []),
              rssSources: WB.store.get("rssSources", []),
              todoLists: WB.store.get("todoLists", []),
              ledgerCats: WB.store.get("ledgerCats", []),
            };
            WB.downloadFile("工作台配置-" + WB.todayStr() + ".json", JSON.stringify(share, null, 2), "application/json");
            WB.ui.toast("配置已导出（不含私人数据）");
          }})),
      row("导入配置", "从分享的配置 JSON 合并导入（同 id 去重，不动日记/账单）", importShareBtn()),
      row("日志笔记", "导出为 Markdown 文件", el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 MD</span>",
        onclick: () => WB.exports && WB.exports.journals()})),
      row("账单", "导出为 CSV 表格", el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 CSV</span>",
        onclick: () => WB.exports && WB.exports.ledger()})),
      row("Obsidian 库", "日志按日一篇 .md（带 frontmatter）+ 笔记 + 账单，zip 解压进 Obsidian 仓库即用",
        el("button", {class: "btn sm", html: icon("download", 15) + "<span>导出 zip</span>",
          onclick: () => WB.exports && WB.exports.obsidian()})),
    ]));

    /* --- 晨雾币 · 奖励商店 --- */
    const coinBox = el("div");
    const coinSub = el("span", {class: "card-sub"});
    const paintBalance = () => { coinSub.textContent = WB.coins.balance() + " 币"; };
    const paintCoins = () => {
      coinBox.innerHTML = "";
      const rs = WB.coins.rewards();
      if(!rs.length){
        coinBox.appendChild(el("div", {class: "small faint", style: {padding: "6px 0"},
          text: "还没有奖励。给自己定几个：完成目标就兑换，别客气。"}));
      }
      rs.forEach(r => {
        coinBox.appendChild(el("div", {class: "row", style: {padding: "7px 0", borderTop: "1px dashed var(--card-border)", alignItems: "center"}},
          el("div", {class: "grow"},
            el("div", {text: r.name, style: {fontSize: "14.5px"}}),
            el("div", {class: "small faint", text: r.cost + " 币"})),
          el("button", {class: "btn sm", text: "兑换",
            onclick: () => {
              if(WB.coins.spend(r.cost, r.name)){
                WB.ui.chime("big"); WB.ui.toast("已兑换「" + r.name + "」，好好享受 ✦");
                paintCoins(); paintBalance();
              }else WB.ui.toast("币还不够，再攒攒（现有 " + WB.coins.balance() + " 币）", "warn");
            }})));
      });
    };
    const rewardName = el("input", {class: "input", placeholder: "奖励名称（如：玩 30 分钟游戏）", style: {maxWidth: "240px"}});
    const rewardCost = el("input", {class: "input", type: "number", min: "1", placeholder: "币", style: {maxWidth: "80px"}});
    const coinAdd = el("div", {class: "row", style: {padding: "9px 0", borderTop: "1px dashed var(--card-border)", gap: "8px", flexWrap: "wrap"}},
      rewardName, rewardCost,
      el("button", {class: "btn sm", html: icon("plus", 14) + "<span>添加奖励</span>",
        onclick: () => {
          const name = rewardName.value.trim(), cost = Math.round(Number(rewardCost.value));
          if(!name || !(cost > 0)){ WB.ui.toast("填好名称和币数", "warn"); return; }
          const rs = WB.coins.rewards().concat({id: WB.uid(), name, cost});
          WB.store.set("coinRewards", rs);
          rewardName.value = ""; rewardCost.value = "";
          paintCoins(); WB.ui.toast("奖励已上架");
        }}));
    paintBalance(); paintCoins();
    wrap.appendChild(el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("star", 18) + "<span>晨雾币 · 奖励商店</span>", onclick: null}, coinSub),
      el("div", {class: "small faint", style: {marginBottom: "6px"},
        text: "完成待办 +2（高优先 +4）· 习惯打卡 +1 · 番茄 +3 · 三大件全完成 +5。赚来的币，花在自己身上。"}),
      coinBox, coinAdd));

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

    /* --- WebDAV 同步（坚果云/Nextcloud/群晖…填自己的账号） --- */
    const wcfg = WB.store.get("webdav", {url: "", user: "", pass: "", auto: false});
    const wField = (label, key, type) => {
      const input = el("input", {class: "input", type: type || "text", value: wcfg[key] || "",
        placeholder: key === "url" ? "https://dav.jianguoyun.com/dav/myfolder/" : "", style: {maxWidth: "320px"}});
      input.addEventListener("change", () => {
        const b = WB.store.get("webdav", {url: "", user: "", pass: ""});
        b[key] = input.value.trim();
        WB.store.set("webdav", b);
        WB.ui.toast("已保存（仅存本机）");
      });
      return row(label, "", input);
    };
    wrap.appendChild(sectionCard("cloud", "WebDAV 同步", [
      el("div", {class: "small muted", style: {marginBottom: "8px"},
        text: "填一个 WebDAV 目录地址（坚果云：dav.jianguoyun.com/dav/你的文件夹/，密码用「应用密码」）。凭据只存本机，浏览器直连你填的服务器。注意：部分服务（如坚果云）不开放浏览器跨域，若始终失败请换 Nextcloud / InfiniCLOUD 等支持 CORS 的服务。"}),
      wField("服务器目录", "url"),
      wField("账号", "user"),
      wField("应用密码", "pass", "password"),
      row("上传备份", "全量数据打包为 JSON 上传到该目录（同名覆盖）",
        el("button", {class: "btn sm", html: icon("upload", 15) + "<span>上传</span>",
          onclick: async () => {
            const r = await WB.webdav.upload();
            if(r.ok) WB.ui.toast("已上传备份（" + (r.kb || "?") + " KB）");
            else WB.ui.toast("上传失败：" + r.err, "warn");
          }})),
      row("拉取恢复", "从该目录读回备份，合并或覆盖（覆盖前自动拍快照）",
        el("button", {class: "btn sm", html: icon("download", 15) + "<span>拉取</span>",
          onclick: async () => {
            const r = await WB.webdav.pull();
            if(!r.ok){ WB.ui.toast("拉取失败：" + r.err, "warn"); return; }
            const mode = await askImportMode();
            if(!mode) return;
            if(mode === "overwrite" && WB.snapshots){ try{ await WB.snapshots.take("拉取覆盖前"); }catch(e){} }
            WB.store.importAll(r.data, {merge: mode === "merge"});
            WB.ui.toast("已" + (mode === "merge" ? "合并" : "覆盖") + "导入，正在刷新…");
            setTimeout(() => location.reload(), 900);
          }})),
      row("自动上传", "数据有变化时，每天首次打开静默上传一次",
        toggle(WB.store.get("webdav", {}).auto, v => {
          const b = WB.store.get("webdav", {});
          b.auto = v;
          WB.store.set("webdav", b);
          WB.ui.toast(v ? "已开启：改了东西就会自动备份到 WebDAV" : "已关闭自动上传");
        })),
    ]));

    /* --- 通知 --- */
    wrap.appendChild(sectionCard("bell", "系统通知", [
      row("浏览器通知", "待办到点提醒（页面开着时生效）", notifyBtn()),
    ]));

    /* --- 快捷键 --- */
    wrap.appendChild(sectionCard("zap", "键盘快捷键", [
      hotkeyRow("Ctrl + K", "万能命令面板（捕捉/跳转/翻译/搜索）"),
      hotkeyRow("N", "新笔记"),
      hotkeyRow("T", "新任务"),
      hotkeyRow("空格", "声音面板 播放/暂停（番茄页）；沉浸专注里是 暂停/继续"),
      hotkeyRow("M", "环境音开关（任何页面，含沉浸专注）"),
      hotkeyRow("P", "番茄钟 暂停/继续（任何页面；待确认时推进到下一段）"),
      hotkeyRow("F", "进入 / 退出沉浸专注（要先开始一段专注）"),
      hotkeyRow("← / →", "沉浸专注里 换上一个 / 下一个场景"),
      hotkeyRow("D", "切换深浅色"),
      hotkeyRow("Esc", "关闭弹窗/面板；沉浸专注里退出沉浸"),
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
    /* 自定义 CSS：整行宽的 textarea，输入即时预览、停顿 700ms 自动落库。
       落库走 theme.set → apply()（唯一挂载点），这里不做任何直接 DOM 注入。
       不订阅重绘、不整页 render —— 输入框被重建等于焦点丢失（踩坑 #065） */
    function cssEditor(){
      const ta = el("textarea", {class: "input", rows: 4, spellcheck: false,
        placeholder: "例如：.card{border-radius:28px}",
        style: {width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: "12.5px", marginTop: "8px"}});
      ta.value = WB.theme.get("customCss") || "";
      const save = WB.debounce(() => {
        const v = ta.value;
        if(v !== (WB.theme.get("customCss") || "")) WB.theme.set("customCss", v);
      }, 700);
      ta.addEventListener("input", save);
      return el("div", {style: {padding: "9px 0", borderTop: "1px dashed var(--card-border)"}},
        el("div", {text: "自定义 CSS", style: {fontSize: "14.5px"}}),
        el("div", {class: "small faint", text: "高级：写 CSS 覆盖任意样式，输入即时生效，停顿后自动保存；清空即恢复原样"}),
        ta);
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
    function seg(items, cur, onSet, cls){
      const box = el("div", {class: "seg" + (cls ? " " + cls : "")});
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
            WB.router.render();          // 「背景」分段控件要跟着切到「自定义」
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
            WB.router.render();
          }else WB.ui.toast("Unsplash 暂不可用，检查 Key 或网络", "warn");
        }}));
      box.appendChild(el("button", {class: "btn sm ghost", text: "恢复默认",
        onclick: () => { WB.theme.set("themeCustomBg", ""); WB.theme.set("bgMode", "blobs"); WB.ui.toast("已恢复奶油风"); WB.router.render(); }}));
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
    /* 导入方式三选一：合并 / 覆盖 / 取消。
       此前是 confirmBox 二选一，而「再想想」、Esc、点遮罩、点 × 都会 resolve(false)，
       被 !overwrite 分支当成「覆盖」——随手关掉对话框就会清空本地全部数据（不可撤销） */
    function askImportMode(){
      return new Promise(resolve => {
        let done = false;
        const pick = v => { if(done) return true; done = true; resolve(v); m.close(); return true; };
        const m = WB.ui.modal({
          title: "导入备份", icon: "upload",
          content: '<p style="line-height:1.8">这份备份要怎么并进本机？<br>'
            + "<b>合并</b>：备份里的数据并入本地，已存在的记录跳过。<br>"
            + "<b>覆盖</b>：用备份替换本机全部数据（会先自动拍一张快照兜底）。</p>",
          actions: [
            {label: "取消", onClick: () => pick(null)},
            {label: "覆盖导入", danger: true, onClick: () => pick("overwrite")},
            {label: "合并导入", primary: true, onClick: () => pick("merge")},
          ],
          onClose: () => { if(!done){ done = true; resolve(null); } },   // 关掉 = 取消，绝不动数据
        });
      });
    }
    function importBtn(){
      const file = el("input", {type: "file", accept: ".json", style: {display: "none"}});
      file.addEventListener("change", async () => {
        const f = file.files[0]; if(!f) return;
        try{
          const text = await f.text();
          const data = JSON.parse(text);
          if(!data || typeof data !== "object" || !data.settings) throw new Error("不是有效的备份文件");
          const mode = await askImportMode();
          if(!mode) return;                       // 取消：什么都不做（原来这里会走覆盖）
          if(mode === "overwrite" && WB.snapshots){
            // 覆盖不可逆，先留一张「导入前」快照（快照页可一键回退）
            try{ await WB.snapshots.take("导入前"); }catch(e){ console.error("[settings] snapshot", e); }
          }
          WB.store.importAll(data, {merge: mode === "merge"});
          WB.ui.toast(mode === "merge" ? "已合并导入，正在刷新…" : "已覆盖导入，正在刷新…");
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
    /* 配置分享导入：识别 __share 格式，合并模式走 importAll（数组按 id 去重、settings 浅合并），不动私人数据 */
    function importShareBtn(){
      const file = el("input", {type: "file", accept: ".json", style: {display: "none"}});
      file.addEventListener("change", async () => {
        const f = file.files[0]; if(!f) return;
        try{
          const data = JSON.parse(await f.text());
          if(!data || data.__share !== 1) throw new Error("不是配置分享文件（请选择「导出配置」生成的 JSON）");
          if(!await WB.ui.confirmBox("将把对方的配置合并进你的工作台（同 id 去重，不影响日记/账单），继续？")) return;
          if(WB.snapshots){ try{ await WB.snapshots.take("导入配置前"); }catch(e){} }
          WB.store.importAll(data, {merge: true});
          WB.ui.toast("配置已导入，正在刷新…");
          setTimeout(() => location.reload(), 900);
        }catch(err){ WB.ui.toast("导入失败：" + err.message, "warn"); }
      });
      const btn = el("button", {class: "btn sm", html: icon("upload", 15) + "<span>导入配置</span>",
        onclick: () => file.click()});
      btn.appendChild(file);
      return btn;
    }
  },
});
})();

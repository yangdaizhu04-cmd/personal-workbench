/* test-immersive.mjs —— 沉浸专注层（js/16-immersive.js）回归探针
   用法：node tools/test-immersive.mjs
        node tools/test-immersive.mjs --fast     → 只测文件夹版（跳过单文件版）
   产物：.tmp/immersive/*.png；有断言失败或控制台错误时退出码 1

   两条 headless 注意事项（踩过的坑，别删）：
   1. 全新 profile 启动时会弹「晨间仪式」弹窗压住沉浸层 → 先关掉它并标记当天已打开；
   2. headless 不出帧时 CSS 过渡的时间轴不推进（读到的是 0ms 的中间值）
      → 读 opacity 之类的过渡结果前先 frame() 强制出一帧 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".tmp/immersive");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if(!chromePath){ console.error("✗ 未找到 Chrome，设 CHROME_PATH 环境变量后重试"); process.exit(2); }

const fast = process.argv.includes("--fast");
const targets = [{name: "folder", url: "file:///" + encodeURI(ROOT.replace(/\\/g, "/")) + "/index.html"}];
if(!fast){
  const singleFile = path.join(ROOT, "个人工作台.html");
  if(!fs.existsSync(singleFile)) console.warn("! 单文件版不存在，跳过（先跑 node build.js）");
  else targets.push({name: "single", url: "file:///" + encodeURI(singleFile.replace(/\\/g, "/"))});
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

const results = [];
function check(target, name, ok, extra){
  results.push({target, name, ok: !!ok, extra: extra === undefined ? "" : String(extra)});
  if(!ok) console.log("  ✗ [%s] %s %s", target, name, extra === undefined ? "" : extra);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-features=Translate", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required"],
});

for(const target of targets){
  const page = await browser.newPage();
  const errors = [];
  page.on("console", msg => {
    if(msg.type() !== "error") return;
    const text = msg.text();
    if(/Failed to load resource|net::ERR_/.test(text)) return;
    errors.push("[console] " + text);
  });
  page.on("pageerror", err => errors.push("[pageerror] " + err.message));
  const frame = async () => { await page.screenshot({clip: {x: 0, y: 0, width: 8, height: 8}}); };

  await page.goto(target.url + "#/pomodoro", {waitUntil: "load", timeout: 30000});
  await sleep(2600);   // 等启动雾层退场 + 晨间仪式弹窗出现
  await page.evaluate(() => {
    if(WB.modalOpen()) WB.closeTopModal();          // 晨间仪式弹窗会挡住沉浸层与输入
    WB.store.set("lastOpenDay", WB.bizDate());
    WB.store.set("pomodoro", null);                 // 每个目标从干净状态起步
    WB.theme.merge({pomoImmersive: true, pomoImmersiveFull: false, pomoImmersiveGuide: true,
      pomoSoundDuck: true, pomoImmersiveAuto: false, pomoImmersiveScene: "mist", motion: true});
  });
  await sleep(500);

  /* 0. 地基 */
  const base = await page.evaluate(() => ({
    imm: !!(WB.immersive && WB.immersive.enter && WB.immersive.isActive),
    duck: !!(WB.sound && WB.sound.setDuck && WB.sound.duckReset),
    fin: !!(WB.pomodoro.finish && WB.pomodoro.stopAndClear),
    modal: WB.modalOpen(),
  }));
  check(target.name, "WB.immersive / WB.sound.setDuck / pomodoro.finish 均可用",
    base.imm && base.duck && base.fin, JSON.stringify(base));
  check(target.name, "起手无弹窗干扰（否则后面的输入断言不可信）", base.modal === false, base.modal);

  /* 1. 没有计时就不给进 */
  await page.evaluate(() => { WB.immersive.enter(); });
  check(target.name, "无计时会话时 enter 不激活", !(await page.evaluate(() => WB.immersive.isActive())));

  /* 2. 开始专注 → 手动进入（pomoImmersiveFull=false 走全屏降级路径） */
  await page.evaluate(() => {
    WB.pomodoro.begin("focus", 25);
    WB.immersive.enter();
  });
  await frame(); await sleep(900); await frame();
  const on = await page.evaluate(() => {
    const st = document.getElementById("focus-stage");
    return {
      active: WB.immersive.isActive(), hidden: st.hidden, isOn: st.classList.contains("is-on"),
      bodyOn: document.body.classList.contains("immersive-on"),
      appOpacity: getComputedStyle(document.getElementById("app")).opacity,
      stageOpacity: getComputedStyle(st).opacity,
      zStage: getComputedStyle(st).zIndex, zApp: getComputedStyle(document.getElementById("app")).zIndex,
      scene: st.dataset.scene, time: st.querySelector(".fs-time").textContent,
      phase: st.querySelector(".fs-phase").textContent,
      today: st.querySelector(".fs-today").textContent, clock: st.querySelector(".fs-clock").textContent,
      full: document.fullscreenElement,
    };
  });
  check(target.name, "进入沉浸：相位/DOM/body 类都到位",
    on.active && !on.hidden && on.isOn && on.bodyOn, JSON.stringify(on));
  check(target.name, "应用外壳淡出 + 沉浸层淡入", Number(on.appOpacity) === 0 && Number(on.stageOpacity) === 1,
    on.appOpacity + " / " + on.stageOpacity);
  check(target.name, "层级 110 压在 #app(1) 之上、弹窗(120)之下", on.zStage === "110" && on.zApp === "1",
    on.zStage + " vs " + on.zApp);
  check(target.name, "全屏被拒也照常用（无 fullscreenElement 但层在）", on.full === null, String(on.full));
  check(target.name, "场景默认晨雾", on.scene === "mist", on.scene);
  check(target.name, "巨型数字为 mm:ss", /^\d{2}:\d{2}$/.test(on.time), on.time);
  check(target.name, "状态小字 = 专注中", on.phase === "专注中", on.phase);
  check(target.name, "今日进度 + 当前时钟已填", /今日 \d+ 个番茄/.test(on.today) && /^\d{2}:\d{2}$/.test(on.clock),
    on.today + " | " + on.clock);

  /* 3. 秒级推进 */
  const before = await page.evaluate(() => ({
    off: parseFloat(document.querySelector("#focus-stage .fs-c-fg").style.strokeDashoffset),
    time: document.querySelector("#focus-stage .fs-time").textContent,
  }));
  await sleep(2600);
  const after = await page.evaluate(() => ({
    off: parseFloat(document.querySelector("#focus-stage .fs-c-fg").style.strokeDashoffset),
    time: document.querySelector("#focus-stage .fs-time").textContent,
    title: document.title, duck: WB.sound.duckLevel(), phase: document.querySelector("#focus-stage .fs-phase").textContent,
  }));
  check(target.name, "进度环 offset 随时间推进", after.off < before.off, before.off + " → " + after.off);
  check(target.name, "数字逐秒变化", after.time !== before.time, before.time + " → " + after.time);
  check(target.name, "标签页标题带倒计时", /·\s*专注\s*·/.test(after.title), after.title);
  check(target.name, "专注中环境音压低到 55%", Math.abs(after.duck - .55) < .01, after.duck);
  check(target.name, "相位广播不打断状态（仍专注中）", after.phase === "专注中", after.phase);

  /* 4. 准备倒数收尾 + 静止自动隐藏 + 一动就回 */
  await sleep(1.6e3);
  const prepDone = await page.evaluate(() => document.querySelector("#focus-stage .fs-prep").hidden);
  check(target.name, "3-2-1 准备倒数自动收尾", prepDone === true, prepDone);
  check(target.name, "静止 3 秒后自动隐藏控件",
    await page.evaluate(() => document.getElementById("focus-stage").classList.contains("chrome-hidden")) === true);
  await page.mouse.move(400, 300);
  await sleep(200);
  check(target.name, "鼠标一动控件立刻回来",
    await page.evaluate(() => !document.getElementById("focus-stage").classList.contains("chrome-hidden")) === true);

  /* 4b. 动态层（B 轮）：四套场景各自的关键帧在跑 + 光斑提速 + 进度色温在长 */
  const fx = await page.evaluate(() => {
    const scene = document.querySelector("#focus-stage .fs-scene");
    const cs = getComputedStyle(scene.querySelector(".fs-fx"), "::before");
    const glow = getComputedStyle(document.querySelector("#focus-stage .fs-glow-a"));
    const tint = getComputedStyle(document.querySelector("#focus-stage .fs-tint"));
    return {
      fxName: cs.animationName, fxDur: cs.animationDuration,
      glowName: glow.animationName, glowDur: glow.animationDuration,
      warmth: getComputedStyle(document.getElementById("focus-stage")).getPropertyValue("--fs-warmth").trim(),
      tintOpacity: tint.opacity, transition: tint.transitionProperty,
    };
  });
  check(target.name, "晨雾场景有动态雾带（keyframes 在跑）",
    fx.fxName === "fsMist" && fx.fxDur !== "0s", JSON.stringify({n: fx.fxName, d: fx.fxDur}));
  check(target.name, "光斑提速到 22s（不是全站的 46s）", fx.glowName === "fsDrift" && fx.glowDur === "22s",
    fx.glowName + " / " + fx.glowDur);
  check(target.name, "进度色温在长，且由 CSS 承担过渡",
    Number(fx.warmth) > 0 && Number(fx.warmth) <= .28 && /opacity/.test(fx.transition) &&
    Math.abs(Number(fx.tintOpacity) - Number(fx.warmth)) < .06,
    JSON.stringify({warmth: fx.warmth, opacity: fx.tintOpacity}));

  /* 4c. 视频背景（vendor/video/）：只在沉浸时挂 src，播起来后盖住 CSS 动态层 */
  await sleep(1400);                       // 本地 mp4，正常远快于此
  const vid = await page.evaluate(() => {
    const v = document.querySelector("#focus-stage .fs-video");
    const fx = document.querySelector("#focus-stage .fs-fx");
    return {
      exists: !!v, src: v ? v.getAttribute("src") : "", paused: v ? v.paused : null,
      on: v ? v.classList.contains("is-on") : false, muted: v ? v.muted : null, loop: v ? v.loop : null,
      vw: v ? v.videoWidth : 0,
      hasVideo: document.getElementById("focus-stage").classList.contains("has-video"),
      fxPlay: fx ? getComputedStyle(fx, "::before").animationPlayState : "",
    };
  });
  // 单文件版刻意不加载视频（自包含），此时 CSS 动态层应该继续跑 —— 两种形态各自断言
  if(target.name === "single"){
    check(target.name, "单文件版不加载视频，CSS 动态层继续运行（自包含降级）",
      vid.exists && vid.src === null && vid.paused === true && vid.on === false &&
      vid.hasVideo === false && vid.fxPlay === "running", JSON.stringify(vid));
  }else{
    check(target.name, "视频背景：1080p、src 指向当前场景、静音循环、在播且盖上 CSS 动态层",
      vid.exists && /vendor\/video\/mist\.mp4$/.test(vid.src) && vid.muted === true && vid.loop === true &&
      vid.paused === false && vid.on && vid.hasVideo && vid.fxPlay === "paused" && vid.vw >= 1920,
      JSON.stringify(vid));
  }

  /* 5. 场景交叉淡入 */
  await page.evaluate(() => WB.immersive.scene("deep", true));
  const cross = await page.evaluate(() => ({
    scene: document.getElementById("focus-stage").dataset.scene,
    slots: document.querySelectorAll("#focus-stage .fs-scene").length,
    out: document.querySelector("#focus-stage .fs-scene-out") ? document.querySelector("#focus-stage .fs-scene-out").dataset.scene : "",
  }));
  check(target.name, "换场景：旧槽位叠层淡出", cross.scene === "deep" && cross.slots === 2 && cross.out === "mist",
    JSON.stringify(cross));
  await sleep(1e3);
  check(target.name, "淡出结束后旧槽位被移除",
    await page.evaluate(() => document.querySelectorAll("#focus-stage .fs-scene").length) === 1);

  /* 5b. 场景选择面板（12 场景：点「◐」弹出网格直接选；Esc 优先关面板）
     上一段已把场景切到 deep，面板里当前项应是 deep */
  await page.evaluate(() => document.querySelector('#focus-stage [data-act="scene"]').click());
  await sleep(400);
  const pk = await page.evaluate(() => ({
    open: WB.immersive.pickerOpen(),
    count: document.querySelectorAll("#focus-stage .fs-pick").length,
    on: document.querySelector("#focus-stage .fs-pick.on") ? document.querySelector("#focus-stage .fs-pick.on").dataset.pick : "",
    visible: !document.querySelector("#focus-stage .fs-picker").hidden,
  }));
  check(target.name, "场景面板：12 项、当前场景高亮、可见",
    pk.open && pk.count === 12 && pk.on === "deep" && pk.visible, JSON.stringify(pk));
  await page.keyboard.press("Escape");
  await sleep(350);
  const escp = await page.evaluate(() => ({open: WB.immersive.pickerOpen(), active: WB.immersive.isActive()}));
  check(target.name, "面板开着时 Esc 只关面板、不退出沉浸", !escp.open && escp.active, JSON.stringify(escp));
  await page.evaluate(() => document.querySelector('#focus-stage [data-act="scene"]').click());
  await sleep(350);
  await page.evaluate(() => document.querySelector('#focus-stage .fs-pick[data-pick="snow"]').click());
  await sleep(450);
  const pk2 = await page.evaluate(() => ({
    scene: document.getElementById("focus-stage").dataset.scene,
    open: WB.immersive.pickerOpen(),
    saved: WB.theme.get("pomoImmersiveScene"),
  }));
  check(target.name, "面板里选场景：切换生效、记住偏好、面板自动关闭",
    pk2.scene === "snow" && !pk2.open && pk2.saved === "snow", JSON.stringify(pk2));
  await page.evaluate(() => WB.immersive.scene("mist", true));   // 回到默认场景，别影响后续断言
  await sleep(600);

  /* 5c. ← / → 键盘换景：切换 + 偏好落盘 + 场景名浮出 + 首尾回绕（CDP 真实按键） */
  await page.evaluate(() => WB.immersive.pick("mist"));
  await sleep(350);
  await page.keyboard.press("ArrowRight");
  await sleep(450);
  const st1 = await page.evaluate(() => ({
    scene: document.getElementById("focus-stage").dataset.scene,
    saved: WB.theme.get("pomoImmersiveScene"),
    note: document.querySelector("#focus-stage .fs-note").textContent,
  }));
  check(target.name, "→ 换下一个场景：切换生效 + 偏好落盘 + 场景名浮出",
    st1.scene === "deep" && st1.saved === "deep" && st1.note === "深海", JSON.stringify(st1));
  await page.keyboard.press("ArrowLeft");
  await sleep(450);
  check(target.name, "← 回退到上一个场景",
    await page.evaluate(() => document.getElementById("focus-stage").dataset.scene) === "mist");
  await page.evaluate(() => WB.immersive.pick("cloud"));          // 走到末位再按 →
  await sleep(350);
  await page.keyboard.press("ArrowRight");
  await sleep(450);
  check(target.name, "末位再按 → 首尾循环回绕到第一位",
    await page.evaluate(() => document.getElementById("focus-stage").dataset.scene) === "mist");
  await page.evaluate(() => WB.immersive.pick("mist"));
  await sleep(500);

  /* 6. 空格 = 暂停/继续（CDP 真实按键） */
  await page.keyboard.press("Space");
  await sleep(300);
  const paused = await page.evaluate(() => ({
    running: WB.pomodoro.state().running, phase: document.querySelector("#focus-stage .fs-phase").textContent,
    duck: WB.sound.duckLevel(), title: document.title,
  }));
  check(target.name, "空格暂停：状态/副标题/标题同步",
    !paused.running && paused.phase === "已暂停" && /已暂停/.test(paused.title), JSON.stringify(paused));
  check(target.name, "暂停时环境音回到基准音量", Math.abs(paused.duck - 1) < .01, paused.duck);
  await page.keyboard.press("Space");
  await sleep(300);
  check(target.name, "空格继续", await page.evaluate(() => WB.pomodoro.state().running) === true);

  /* 6b. M = 环境音全开关（沉浸里与右上角 ♪ 同一条路径，按钮状态同步） */
  await page.keyboard.press("m");
  await sleep(700);
  const snd1 = await page.evaluate(() => ({
    playing: WB.sound.anyPlaying(),
    btnOff: document.querySelector('#focus-stage [data-act="sound"]').classList.contains("is-off"),
  }));
  check(target.name, "沉浸中按 M 开环境音，♪ 按钮同步点亮",
    snd1.playing === true && snd1.btnOff === false, JSON.stringify(snd1));
  await page.keyboard.press("m");
  await sleep(700);
  const snd2 = await page.evaluate(() => ({
    playing: WB.sound.anyPlaying(),
    btnOff: document.querySelector('#focus-stage [data-act="sound"]').classList.contains("is-off"),
  }));
  check(target.name, "再按 M 静音，♪ 按钮转灰",
    snd2.playing === false && snd2.btnOff === true, JSON.stringify(snd2));
  await page.evaluate(() => WB.store.set("soundPrefs", {}));    // 不留「开了雨声」给后续断言
  await sleep(300);

  /* 7. 完成本段 → 待确认（此刻空格应推进到下一段，而不是把这段重新跑起来） */
  await page.evaluate(() => WB.immersive.finishPhase());
  await sleep(500);
  const done = await page.evaluate(() => ({
    need: WB.pomodoro.state().needConfirm, phase: document.querySelector("#focus-stage .fs-phase").textContent,
    noteVisible: document.querySelector("#focus-stage .fs-note").hidden === false,
    btns: Array.from(document.querySelectorAll("#focus-stage .fs-btn")).map(b => b.dataset.act).join(","),
  }));
  check(target.name, "完成本段 → 待确认 + 中央提示语", done.need && done.phase === "专注完成" && done.noteVisible,
    JSON.stringify(done));
  check(target.name, "控件切到「开始休息 / 先到这」", done.btns === "next,done", done.btns);
  const log = await page.evaluate(() => WB.store.get("pomoLog", []).slice(-1)[0] || {});
  check(target.name, "成绩已落库（pomoLog.done）", log.status === "done" && log.mode === "focus",
    JSON.stringify({status: log.status, mode: log.mode}));

  /* 8. 空格式推进：待确认时不能走 resume（否则重复计时 + 重复记分） */
  const logsBefore = await page.evaluate(() => WB.store.get("pomoLog", []).length);
  await page.keyboard.press("Space");
  await sleep(700);
  const next = await page.evaluate(() => ({
    mode: WB.pomodoro.state().mode, running: WB.pomodoro.state().running,
    need: WB.pomodoro.state().needConfirm, logs: WB.store.get("pomoLog", []).length,
  }));
  check(target.name, "待确认时空格 = 推进到下一段（休息开跑）",
    next.mode === "rest" && next.running && !next.need && next.logs === logsBefore, JSON.stringify(next));

  /* 9. 休息中挂上呼吸引导 */
  const rest = await page.evaluate(() => ({
    breathing: document.querySelector("#focus-stage .fs-ringwrap").classList.contains("is-breathing"),
    breath: document.querySelector("#focus-stage .fs-breath").textContent,
  }));
  check(target.name, "休息中挂上 4-7-8 呼吸引导", rest.breathing && /吸|屏|呼/.test(rest.breath), JSON.stringify(rest));

  /* 10. 确认框压在沉浸层之上；Esc 先关弹窗、不能穿过它退沉浸；点按钮后不留残影 */
  const layering = await page.evaluate(async () => {
    const p = WB.ui.confirmBox("探针：层级检查", {danger: true, okLabel: "好"});
    await new Promise(r => setTimeout(r, 250));
    const scrim = document.querySelector(".modal-scrim");
    const out = {
      z: scrim ? getComputedStyle(scrim).zIndex : "",
      h: scrim ? scrim.getBoundingClientRect().height : 0,
      openWhileConfirm: WB.modalOpen(),
    };
    dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    out.escResolved = await Promise.race([p.then(v => "resolved:" + v),
      new Promise(r => setTimeout(() => r("timeout"), 900))]);
    await new Promise(r => setTimeout(r, 500));
    out.scrimsLeft = document.querySelectorAll(".modal-scrim").length;
    out.stillImmersive = WB.immersive.isActive();
    return out;
  });
  check(target.name, "确认框压在沉浸层之上，Esc 先关弹窗、不退沉浸",
    layering.z === "120" && layering.h > 0 && layering.openWhileConfirm === true &&
    /resolved:false/.test(layering.escResolved) && layering.scrimsLeft === 0 && layering.stillImmersive === true,
    JSON.stringify(layering));

  /* 10b. 点按钮同样要真的关掉（此前 confirmBox 用完会把遮罩永久留在 DOM 里挡住整页） */
  const btnClose = await page.evaluate(async () => {
    const p = WB.ui.confirmBox("探针：关闭检查", {danger: true, okLabel: "好"});
    await new Promise(r => setTimeout(r, 250));
    document.querySelector(".modal-scrim .btn.danger").click();
    const v = await p;
    await new Promise(r => setTimeout(r, 500));
    return {v: v, scrims: document.querySelectorAll(".modal-scrim").length,
      topmost: (() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? e.tagName : "null"; })()};
  });
  check(target.name, "确认框按钮点了真关闭，遮罩不再残留挡页",
    btnClose.v === true && btnClose.scrims === 0, JSON.stringify(btnClose));

  /* 11. Esc 退出 */
  await page.keyboard.press("Escape");
  await frame(); await sleep(900); await frame();
  const exited = await page.evaluate(() => {
    const v = document.querySelector("#focus-stage .fs-video");
    return {
      active: WB.immersive.isActive(), hidden: document.getElementById("focus-stage").hidden,
      bodyOn: document.body.classList.contains("immersive-on"),
      appOpacity: getComputedStyle(document.getElementById("app")).opacity,
      stageOpacity: getComputedStyle(document.getElementById("focus-stage")).opacity,
      title: document.title, duck: WB.sound.duckLevel(),
      vsrc: v ? v.getAttribute("src") : null, vpaused: v ? v.paused : null,
      hasVideo: document.getElementById("focus-stage").classList.contains("has-video"),
    };
  });
  check(target.name, "Esc 退出：层收起、外壳回来、标题还原",
    !exited.active && exited.hidden && !exited.bodyOn && Number(exited.appOpacity) === 1 &&
    Number(exited.stageOpacity) === 0 && !/专注\s*·/.test(exited.title), JSON.stringify(exited));
  check(target.name, "退出即释放视频（src 清空、已暂停、动态层恢复）",
    exited.vsrc === null && exited.vpaused === true && exited.hasVideo === false, JSON.stringify(exited));
  check(target.name, "计时不受退层影响（休息仍在跑）",
    await page.evaluate(() => WB.pomodoro.state().running) === true);

  /* 12. 放弃 → 状态清空 → 沉浸自动退出 */
  await page.evaluate(async () => {
    WB.immersive.enter();
    await new Promise(r => setTimeout(r, 400));
    await WB.immersive.abandon();
  });
  await sleep(1.1e3);
  check(target.name, "放弃后自动退出并清空计时",
    await page.evaluate(() => !WB.immersive.isActive() && WB.pomodoro.state() === null));

  /* 13. 自动进入设置项 + 到点自然结束（pomo:finish 曾是死订阅） */
  await page.evaluate(() => {
    WB.theme.merge({pomoImmersiveAuto: true});
    window.__pf = [];
    WB.bus.on("pomo:finish", e => window.__pf.push(e));
    WB.pomodoro.begin("focus", 25);
  });
  await sleep(700);
  check(target.name, "开始专注自动进入沉浸（设置项生效）",
    await page.evaluate(() => WB.immersive.isActive()) === true);
  await page.evaluate(() => {
    WB.immersive.exit();
    const s = WB.store.get("pomodoro", {});
    s.plannedSec = 2; s.accumMs = 0; s.resumeTs = Date.now(); s.running = true; s.needConfirm = false;
    WB.store.set("pomodoro", s);
    WB.pomodoro.pause(); WB.pomodoro.resume();     // 让心跳按新的 plannedSec 接上
  });
  await sleep(3.8e3);
  const fin = await page.evaluate(() => ({
    events: window.__pf, log: WB.store.get("pomoLog", []).slice(-1)[0] || {},
  }));
  check(target.name, "到点自然结束 emit pomo:finish（死订阅已修）", fin.events.length >= 1, JSON.stringify(fin.events));
  check(target.name, "到点结算写入 pomoLog", fin.log.status === "done", JSON.stringify(fin.log));

  /* 14. no-motion 熔断下功能不残 */
  await page.evaluate(() => {
    WB.theme.set("motion", false);
    WB.pomodoro.begin("focus", 25);
    WB.immersive.enter();
  });
  await sleep(700);
  const m1 = await page.evaluate(() => ({
    off: parseFloat(document.querySelector("#focus-stage .fs-c-fg").style.strokeDashoffset),
    time: document.querySelector("#focus-stage .fs-time").textContent,
  }));
  await sleep(3900);   // 准备倒数是 3×1100ms + 520ms 收尾，要等它走完
  const m2 = await page.evaluate(() => ({
    off: parseFloat(document.querySelector("#focus-stage .fs-c-fg").style.strokeDashoffset),
    time: document.querySelector("#focus-stage .fs-time").textContent,
    noMotion: document.documentElement.classList.contains("no-motion"),
    prepHidden: document.querySelector("#focus-stage .fs-prep").hidden,
    vsrc: (document.querySelector("#focus-stage .fs-video") || {getAttribute(){return null;}}).getAttribute("src"),
  }));
  check(target.name, "no-motion：环与数字照常推进（只是没动画）",
    m2.off < m1.off && m2.time !== m1.time, JSON.stringify([m1, m2]));
  check(target.name, "no-motion：准备倒数不残留", m2.noMotion && m2.prepHidden === true, JSON.stringify(m2));
  check(target.name, "no-motion：不加载视频背景（只留 CSS 场景）", m2.vsrc === null, String(m2.vsrc));
  await page.evaluate(() => WB.theme.set("motion", true));

  /* 15. 截图：桌面 1440×900（十二套场景）+ 移动 400×800 + 双主题 */
  await page.mouse.move(700, 500);          // 唤出控件，控件也要入镜
  await sleep(200);
  if(target.name === "folder"){
    await page.setViewport({width: 1440, height: 900});
    await sleep(400);
    const FX = {mist: "fsMist", deep: "fsSway", ember: "fsFlicker", star: "fsTwinkle",
      snow: "fsSnow", lake: "fsShimmer", sea: "fsShimmer", meadow: "fsSway",
      dune: "fsSand", glade: "fsDapple", fall: "fsSpray", cloud: "fsRoll"};
    for(const sc of ["mist", "deep", "ember", "star", "snow", "lake", "sea", "meadow",
      "dune", "glade", "fall", "cloud"]){
      await page.evaluate(s => WB.immersive.scene(s, true), sc);
      await page.mouse.move(700, 500);
      await sleep(900);
      const name = await page.evaluate(() =>
        getComputedStyle(document.querySelector("#focus-stage .fs-fx"), "::before").animationName);
      check(target.name, "场景「" + sc + "」的动态层在跑", name === FX[sc], name);
      const vsrc = await page.evaluate(() =>
        (document.querySelector("#focus-stage .fs-video") || {getAttribute(){return null;}}).getAttribute("src"));
      check(target.name, "场景「" + sc + "」的视频同步换片",
        new RegExp("vendor/video/" + sc + "\\.mp4$").test(String(vsrc)), String(vsrc));
      await page.screenshot({path: path.join(OUT, target.name + "-" + sc + "-light.png")});
    }
    await page.evaluate(() => WB.immersive.scene("ember", true));
    await page.setViewport({width: 400, height: 800});
    await page.mouse.move(200, 400);
    await sleep(900);
    await page.screenshot({path: path.join(OUT, target.name + "-mobile-light.png")});
    await page.setViewport({width: 1440, height: 900});
    await sleep(300);
  }
  for(const theme of ["light", "dark"]){
    await page.evaluate(t => WB.theme.set("theme", t), theme);
    await page.evaluate(() => WB.immersive.scene("mist", true));
    await page.mouse.move(700, 500);
    await sleep(900);
    await page.screenshot({path: path.join(OUT, target.name + "-" + theme + ".png")});
  }
  // 控件隐藏态的纯净画面（这是「沉浸」的常态，也要留下一张）
  await page.evaluate(() => WB.theme.set("theme", "light"));
  await sleep(3.6e3);
  await page.screenshot({path: path.join(OUT, target.name + "-quiet.png")});
  check(target.name, "静止后画面回到纯净态（控件自动隐藏）",
    await page.evaluate(() => document.getElementById("focus-stage").classList.contains("chrome-hidden")) === true);
  await page.evaluate(() => WB.immersive.exit());
  if(target.name === "folder") await page.setViewport({width: 800, height: 600});
  await sleep(300);

  /* 15b. 动态壁纸开着时：透出壁纸 + 压暗面 + 文字转浅色（文件夹版专属分支） */
  if(target.name === "folder"){
    await page.evaluate(() => { WB.theme.set("bgMode", "dynamic"); WB.immersive.enter(); });
    await sleep(1e3);
    await frame();
    await sleep(3.4e3);     // 等准备倒数的幕布收掉，截图才看得清壁纸透出效果
    const wp = await page.evaluate(() => ({
      dyn: document.body.classList.contains("bg-dynamic-on"),
      islands: document.body.classList.contains("wb-islands"),
      sceneOpacity: getComputedStyle(document.querySelector("#focus-stage .fs-scene")).opacity,
      ink: getComputedStyle(document.getElementById("focus-stage")).color,
      veiled: getComputedStyle(document.querySelector("#focus-stage .fs-veil")).backgroundColor,
    }));
    check(target.name, "动态壁纸分支：场景层压到 26% 透出壁纸，配色跟随主题（亮=奶油雾+深字）",
      wp.dyn && wp.islands && Math.abs(Number(wp.sceneOpacity) - .26) < .01 &&
      wp.ink === "rgb(63, 75, 89)", JSON.stringify(wp));
    await page.mouse.move(700, 500);
    await sleep(700);
    await page.screenshot({path: path.join(OUT, target.name + "-wallpaper.png")});
    const wpDark = await page.evaluate(async () => {
      WB.theme.set("theme", "dark");
      await new Promise(r => setTimeout(r, 1100));   // 雾面是 700ms 渐变，要等它走完再读
      return {ink: getComputedStyle(document.getElementById("focus-stage")).color,
        veil: getComputedStyle(document.querySelector("#focus-stage .fs-veil")).backgroundColor};
    });
    check(target.name, "动态壁纸 + 夜雾：文字转浅、压暗面转夜雾色",
      wpDark.ink === "rgb(240, 238, 232)" && /rgba\(12, 14, 22/.test(wpDark.veil), JSON.stringify(wpDark));
    await page.mouse.move(700, 500);
    await sleep(600);
    await page.screenshot({path: path.join(OUT, target.name + "-wallpaper-dark.png")});
    await page.evaluate(() => WB.theme.set("theme", "light"));
    await page.evaluate(() => { WB.immersive.exit(); WB.theme.set("bgMode", "blobs"); });
    await sleep(900);
  }

  /* 16. 单文件版专属：无 islands → 回落纯 CSS 场景 */
  if(target.name === "single"){
    const wp = await page.evaluate(() => ({
      single: !!window.WB_SINGLE_FILE, islands: document.body.classList.contains("wb-islands"),
    }));
    check(target.name, "单文件版 WB_SINGLE_FILE 生效且无 islands（纯 CSS 场景兜底）",
      wp.single && !wp.islands, JSON.stringify(wp));
  }

  /* 17. 沉浸外的新入口：番茄卡场景条 / P 控计时 / M 控声音 / ⌘K 场景命令 */
  /* 第 13 段为验证「自动进沉浸」把 pomoImmersiveAuto 开成 true 且没恢复 ——
     这里必须先关掉再退干净，否则下面的 begin() 会自动进沉浸，P 就落到沉浸分支上 */
  await page.evaluate(() => {
    WB.theme.merge({pomoImmersiveAuto: false});
    if(WB.immersive.isActive()) WB.immersive.exit();
    WB.router.go("pomodoro");
  });
  await sleep(800);
  check(target.name, "第 17 段前置：确实在沉浸外（否则下面测的是沉浸分支）",
    await page.evaluate(() => !WB.immersive.isActive()));
  const dots = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll("#view .fs-pick-dot"));
    return {n: list.length, mine: list.map(d => d.dataset.scene).join(","),
      order: (WB.immersive.order || []).join(",")};
  });
  check(target.name, "番茄卡场景条：12 个色点、顺序与场景表一致",
    dots.n === 12 && dots.mine === dots.order, JSON.stringify(dots));
  await page.evaluate(() => document.querySelectorAll("#view .fs-pick-dot")[4].click());   // 第 5 个 = snow
  await sleep(500);
  check(target.name, "点色点 = 记住偏好（沉浸外不换景，下次进沉浸生效）",
    await page.evaluate(() => WB.theme.get("pomoImmersiveScene")) === "snow");
  await page.evaluate(() => { if(WB.pomodoro.state()) WB.pomodoro.stopAndClear(); WB.pomodoro.begin("focus", 25); });
  await sleep(500);
  await page.keyboard.press("p");
  await sleep(500);
  const pp = await page.evaluate(() => {
    // 不能只看最后一条：同期可能混入「导出备份」这类定时提醒 toast
    const ts = Array.from(document.querySelectorAll("#toast-root .toast"));
    return {running: WB.pomodoro.state().running,
      texts: ts.map(t => t.textContent).join(" | ").slice(0, 140)};
  });
  check(target.name, "沉浸外按 P 暂停计时 + 轻提示（已暂停 · 剩 mm:ss）",
    pp.running === false && /已暂停 · 剩 \d{2}:\d{2}/.test(pp.texts), JSON.stringify(pp));
  await page.keyboard.press("p");
  await sleep(500);
  check(target.name, "再按 P 继续", await page.evaluate(() => WB.pomodoro.state().running) === true);
  await page.keyboard.press("m");
  await sleep(700);
  check(target.name, "沉浸外按 M 也能开环境音（与空格同义）",
    await page.evaluate(() => WB.sound.anyPlaying()) === true);
  await page.keyboard.press("m");
  await sleep(700);
  check(target.name, "再按 M 静音", await page.evaluate(() => WB.sound.anyPlaying()) === false);
  await page.evaluate(() => WB.store.set("soundPrefs", {}));
  await page.evaluate(() => WB.commands.open());
  await sleep(500);
  await page.evaluate(() => {          // 中文用派发 input 事件，别走 CDP 逐键（中文输入不稳）
    const i = document.querySelector("#cmdk-root input");
    i.value = "沙丘";
    i.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await sleep(500);
  const cmdk = await page.evaluate(() => document.querySelector("#cmdk-root .cmdk-list").textContent);
  check(target.name, "⌘K 搜「沙丘」出现「沉浸场景」命令",
    cmdk.includes("沉浸场景") && cmdk.includes("场景 · 沙丘"), cmdk.slice(0, 60));
  await page.keyboard.press("Enter");
  await sleep(500);
  check(target.name, "⌘K 执行后偏好落盘为沙丘",
    await page.evaluate(() => WB.theme.get("pomoImmersiveScene")) === "dune");
  await page.evaluate(() => { if(WB.pomodoro.state()) WB.pomodoro.stopAndClear(); });
  await sleep(400);

  check(target.name, "全流程零控制台/页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser.close();

const bad = results.filter(r => !r.ok);
console.log("\n—— 沉浸专注层回归 ——");
for(const t of targets) console.log("  %s: %d 项", t.name, results.filter(r => r.target === t.name).length);
console.log("  通过 %d / %d", results.length - bad.length, results.length);
if(bad.length){
  console.log("\n失败项：");
  bad.forEach(r => console.log("  ✗ [%s] %s %s", r.target, r.name, r.extra));
  process.exit(1);
}
console.log("✅ 全部通过（截图在 .tmp/immersive/）");

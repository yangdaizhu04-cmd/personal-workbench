/* modules/fun.js —— 轻娱乐角：吃什么转盘（带食谱）/ 小确幸 / 拼图 / 涂鸦板 / 治愈一刻 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;

/* ---------- 吃什么转盘 ---------- */
function dishOptions(){
  let arr = WB.store.get("dishOptions", null);
  if(!arr){
    arr = WB.content.RECIPES.slice(0, 12).map(r => r.name);
    WB.store.set("dishOptions", arr);
  }
  return arr;
}
function spinWheel(){
  const arr = dishOptions();
  if(arr.length < 2){ WB.ui.toast("先添加至少 2 个选项", "warn"); return; }
  const pick = arr[Math.floor(Math.random() * arr.length)];
  // 转盘动画：CSS rotate
  const wheel = document.getElementById("dish-wheel");
  const overlay = wheel && wheel.__overlay;
  if(overlay){
    const turns = 5 + Math.random() * 3;
    const seg = 360 / arr.length;
    const idx = arr.indexOf(pick);
    const target = turns * 360 + (360 - idx * seg - seg / 2);
    overlay.style.transform = "rotate(" + target + "deg)";
  }
  setTimeout(() => showDish(pick), 2600);
}
function showDish(name){
  const r = WB.content.RECIPES.find(x => x.name === name);
  const body = el("div", {class: "center col", style: {gap: "10px"}});
  body.appendChild(el("div", {style: {fontSize: "40px"}, text: "🍲"}));
  body.appendChild(el("div", {style: {fontSize: "24px", fontWeight: "700"}, text: "就吃「" + name + "」！"}));
  if(r){
    const stepsOl = el("ol", {class: "small muted", style: {marginTop: "4px", paddingLeft: "18px"}},
      r.steps.map(s => el("li", {style: {marginBottom: "3px"}, text: s})));
    body.appendChild(el("div", {class: "card", style: {width: "100%", background: "var(--card-2)", boxShadow: "none", textAlign: "left"}},
      el("div", {class: "small", style: {fontWeight: "600"}, text: "🥬 食材"}),
      el("div", {class: "small muted", style: {margin: "4px 0 10px"}, text: r.ings.join("、")}),
      el("div", {class: "small", style: {fontWeight: "600"}, text: "👨‍🍳 做法"}),
      stepsOl));
  }
  const actions = [
    {label: "记录到今天日志", onClick: () => {
      const j = WB.collection("journals");
      const today = WB.bizDate();
      const ex = j.all().find(x => x.date === today);
      const line = "今天吃：" + name;
      if(ex) j.update(ex.id, {free: (ex.free ? ex.free + "\n" : "") + line});
      else j.add({date: today, free: line});
      WB.ui.toast("已记入今日日志");
      WB.router.render();
      return false;
    }},
    {label: "换一个", onClick: () => { spinWheel(); return false; }},
    {label: "就它了", primary: true, onClick: () => {}},
  ];
  WB.ui.modal({title: "今天吃什么", icon: "plate", content: body,
    actions: r ? actions : [{label: "换一个", onClick: () => { spinWheel(); return false; }}, {label: "就它了", primary: true, onClick: () => {}}]});
}

/* ---------- 拼图 ---------- */
const PUZZLE_ART = [
  ["#f6e7d3", "#e8b4a8", "#a9c6d8", "#b9aade", "#eedcb2", "#9ec8b4"],
];
function puzzleModal(){
  const n = 3; // 3×3
  const colors = PUZZLE_ART[0];
  const body = el("div", {class: "center col", style: {gap: "10px"}});
  const info = el("div", {class: "small muted", text: "点击两块交换，拼回原图（奶油色系）"});
  const board = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(" + n + ", 64px)", gap: "4px"}});
  body.appendChild(info); body.appendChild(board);
  let cells = [];
  for(let i = 0; i < n * n; i++) cells.push(i);
  let sel = -1, moves = 0;
  const render = () => {
    board.innerHTML = "";
    cells.forEach((v, i) => {
      const row = Math.floor(v / n), col = v % n;
      const c1 = colors[row % colors.length], c2 = colors[(col + 2) % colors.length];
      const cell = el("button", {
        style: {width: "64px", height: "64px", borderRadius: "10px", cursor: "pointer",
          background: "linear-gradient(135deg, " + c1 + ", " + c2 + ")",
          border: sel === i ? "3px solid var(--accent)" : "2px solid var(--card-border)",
          fontSize: "18px", fontWeight: "700", color: "rgba(255,255,255,.85)",
          transition: "transform .15s"},
        text: String(v + 1),
        onclick: () => {
          if(sel === -1){ sel = i; }
          else if(sel === i){ sel = -1; }
          else{
            [cells[sel], cells[i]] = [cells[i], cells[sel]];
            sel = -1; moves++;
          }
          render();
          if(cells.every((x, j) => x === j) && moves > 0){
            WB.ui.celebrate({big: true});
            info.textContent = "🎉 " + moves + " 步完成！手速不错";
          }
        }});
      board.appendChild(cell);
    });
  };
  // 打乱
  do{ cells.sort(() => Math.random() - .5); }while(cells.every((x, i) => x === i));
  render();
  WB.ui.modal({title: "休息小游戏 · 拼图", icon: "gamepad", content: body,
    actions: [{label: "关", primary: true, onClick: () => {}}]});
}

/* ---------- 涂鸦板 ---------- */
function doodleModal(){
  const body = el("div", {class: "col", style: {gap: "10px"}});
  const cv = el("canvas", {width: 460, height: 320,
    style: {width: "100%", background: "#fdfaf3", borderRadius: "14px", border: "1px solid var(--card-border)",
      cursor: "crosshair", touchAction: "none"}});
  body.appendChild(cv);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fdfaf3"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 3;
  const cs = getComputedStyle(document.documentElement);
  let color = cs.getPropertyValue("--accent").trim(), drawing = false;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return [(p.clientX - r.left) * cv.width / r.width, (p.clientY - r.top) * cv.height / r.height];
  };
  const start = e => { drawing = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + .1, y + .1); ctx.stroke(); };
  const move = e => { if(!drawing) return; e.preventDefault(); const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
  const end = () => { drawing = false; };
  cv.addEventListener("mousedown", start); cv.addEventListener("mousemove", move);
  addEventListener("mouseup", end);
  cv.addEventListener("touchstart", start, {passive: true}); cv.addEventListener("touchmove", move, {passive: false}); cv.addEventListener("touchend", end);

  const bar = el("div", {class: "row", style: {gap: "6px", flexWrap: "wrap"}});
  [cs.getPropertyValue("--accent").trim(), cs.getPropertyValue("--accent-2").trim(), "#45403a", "#dd9a84", "#8fbf9f", "#e8cf8f"].forEach(c => {
    bar.appendChild(el("button", {style: {width: "26px", height: "26px", borderRadius: "50%", background: c,
      border: color === c ? "3px solid var(--ink)" : "2px solid var(--card-border)"},
      onclick: () => { color = c; ctx.strokeStyle = c; }}));
  });
  bar.appendChild(el("button", {class: "btn sm", text: "清空", onclick: () => { ctx.fillStyle = "#fdfaf3"; ctx.fillRect(0, 0, cv.width, cv.height); }}));
  body.appendChild(bar);

  WB.ui.modal({title: "迷你涂鸦板", icon: "palette", content: body,
    actions: [{label: "保存到本地", primary: true, onClick: () => {
      cv.toBlob(async blob => {
        const id = WB.uid();
        await WB.idb.put("doodle:" + id, blob, {ts: Date.now()});
        const idx = WB.store.get("doodles", []);
        idx.push({id, name: "涂鸦 " + new Date().toLocaleString(), ts: Date.now()});
        WB.store.set("doodles", idx);
        WB.ui.toast("已保存，可随时回看");
      });
    }}]});
}
function doodleGallery(){
  const list = WB.store.get("doodles", []).sort((a, b) => b.ts - a.ts);
  const body = el("div", {class: "grid", style: {gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "10px"}});
  if(!list.length){ body.appendChild(el("div", {class: "small faint"}, "还没有作品")); }
  list.forEach(d => {
    WB.idb.get("doodle:" + d.id).then(rec => {
      if(!rec) return;
      const url = URL.createObjectURL(rec.data);
      const cell = el("div", {class: "card", style: {padding: "8px"}},
        el("img", {src: url, style: {width: "100%", borderRadius: "8px"}}),
        el("div", {class: "row small faint", style: {marginTop: "4px"}},
          el("span", {class: "grow ellipsis", text: d.name}),
          el("button", {class: "icon-btn", html: icon("trash", 13), onclick: async () => {
            await WB.idb.del("doodle:" + d.id);
            WB.store.set("doodles", WB.store.get("doodles", []).filter(x => x.id !== d.id));
            body.querySelectorAll(".card").forEach(c => c.contains(document.activeElement) || 0);
            WB.router.render(); doodleGallery();
          }})));
      body.appendChild(cell);
    });
  });
  WB.ui.modal({title: "我的涂鸦", icon: "image", content: body, wide: true,
    actions: [{label: "关", primary: true, onClick: () => {}}]});
}

/* ---------- 治愈一刻 ---------- */
const PET_ART = [
  ["🐱", "一只奶油猫蜷在窗台打盹，尾巴尖轻轻晃"],
  ["🐶", "一只柴犬叼着叶子跑过草坪，开心得不得了"],
  ["🐰", "小兔子耳朵贴着背，正在认真洗脸"],
  ["🐱", "猫猫伸了个大大的懒腰，肚皮朝上"],
  ["🐶", "狗狗把下巴搁在你膝盖上，抬头看你"],
];
function petModal(){
  const body = el("div", {class: "center col", style: {gap: "10px", minHeight: "200px"}});
  body.appendChild(el("div", {class: "small faint", text: "向宇宙申请一只小可爱…"}));
  WB.ui.modal({title: "治愈一刻", icon: "heart", content: body,
    actions: [{label: "再来一只", onClick: () => { loadPet(); return false; }}, {label: "被治愈了", primary: true, onClick: () => {}}]});

  async function loadPet(){
    if(WB.pet && WB.pet.fetch){
      const ok = await WB.pet.fetch(body);
      if(ok) return;
    }
    // 内置插画兜底
    body.innerHTML = "";
    const [emoji, text] = PET_ART[Math.floor(Math.random() * PET_ART.length)];
    // 走 .breathe（3s 短周期）而不是复用 blob 的 46s blobFloat：
    // 内联 animation 还会绕过 html.no-motion 的熔断
    body.appendChild(el("div", {class: "pet-art breathe", text: emoji}));
    body.appendChild(el("div", {class: "muted", style: {textAlign: "center", lineHeight: 1.9}, text}));
    body.appendChild(el("div", {class: "small faint", text: "（离线奶油风插画 · 联网可看真实猫猫狗狗）"}));
  }
  loadPet();
}

/* ---------- 模块 ---------- */
WB.registerModule({
  id: "fun",
  title: "轻娱乐角",
  icon: "gamepad",
  sub: () => "休息一下，允许自己玩五分钟",

  render(view){
    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});

    /* 吃什么转盘 */
    const dishCard = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("plate", 18) + "<span>今天吃什么</span>"}));
    const wheelWrap = el("div", {class: "center", style: {padding: "12px 0"}});
    const wheelSize = 210;
    const arr = dishOptions();
    const seg = 360 / Math.max(arr.length, 1);
    let conic = "";
    const wheelColors = ["#f3e5d3", "#e5d9ec", "#dde9e2", "#f0e0c8"];
    arr.forEach((_, i) => {
      conic += wheelColors[i % wheelColors.length] + " " + (i * seg) + "deg " + ((i + 1) * seg) + "deg, ";
    });
    const overlay = el("div", {id: "dish-wheel", style: {width: wheelSize + "px", height: wheelSize + "px", borderRadius: "50%",
      background: "conic-gradient(" + conic.slice(0, -2) + ")",
      border: "6px solid var(--card)", boxShadow: "var(--shadow)",
      transition: "transform 2.5s var(--ease-spin)", position: "relative"}});
    // 选项文字
    arr.forEach((name, i) => {
      const angle = (i * seg + seg / 2) * Math.PI / 180;
      const r = wheelSize / 2 - 30;
      const label = el("span", {text: name.slice(0, 4),
        style: {position: "absolute", left: (wheelSize / 2 + r * Math.sin(angle) - 24) + "px",
          top: (wheelSize / 2 - r * Math.cos(angle) - 9) + "px",
          width: "48px", textAlign: "center", fontSize: "10.5px", color: "var(--ink-2)",
          transform: "rotate(" + (i * seg + seg / 2) + "deg)"}});
      overlay.appendChild(label);
    });
    overlay.__overlay = overlay;
    const pointer = el("div", {text: "▼", style: {position: "absolute", top: "-16px", left: "50%", marginLeft: "-10px",
      fontSize: "20px", color: "var(--accent)", zIndex: 2}});
    wheelWrap.appendChild(pointer);
    wheelWrap.appendChild(overlay);
    dishCard.appendChild(wheelWrap);
    dishCard.appendChild(el("div", {class: "row", style: {justifyContent: "center", gap: "8px"}},
      el("button", {class: "btn primary", text: "🎰 转起来",
        onclick: () => { overlay.style.transform = "rotate(0deg)"; setTimeout(spinWheel, 60); }}),
      el("button", {class: "btn sm", text: "选项管理", onclick: dishManager})));
    grid.appendChild(dishCard);

    /* 其他小卡 */
    const side = el("div", {class: "col", style: {gap: "14px"}});
    side.appendChild(el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("dice", 18) + "<span>随机小确幸</span>"}),
      el("div", {id: "fun-task", class: "", style: {fontSize: "16px", lineHeight: 1.9, minHeight: "54px"}, text: "点骰子，抽一件温柔的小事"}),
      el("button", {class: "btn sm primary", text: "🎲 抽一个",
        onclick: e => {
          const t = WB.content.FUN_TASKS[Math.floor(Math.random() * WB.content.FUN_TASKS.length)];
          const box = document.getElementById("fun-task");
          box.textContent = t;
          if(WB.gsapReady()){ gsap.fromTo(box, {opacity: 0, y: 6}, {opacity: 1, y: 0, duration: .4}); }
          WB.ui.starBurst(e.clientX, e.clientY);
        }})));
    const gameCard = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("gamepad", 18) + "<span>休息小游戏</span>"}),
      el("div", {class: "row", style: {gap: "8px", flexWrap: "wrap"}},
        el("button", {class: "btn sm", text: "🧩 拼图", onclick: puzzleModal}),
        el("button", {class: "btn sm", text: "🎨 涂鸦板", onclick: doodleModal}),
        el("button", {class: "btn sm", text: "🖼 我的作品", onclick: doodleGallery})));
    side.appendChild(gameCard);
    const petCard = el("div", {class: "card"},
      el("div", {class: "card-title", html: icon("heart", 18) + "<span>治愈一刻</span><span class='card-sub'>TheCatAPI / dog.ceo · 断网换插画</span>"}),
      el("button", {class: "btn primary sm", text: "🐾 给我看小可爱",
        onclick: petModal}));
    side.appendChild(petCard);
    grid.appendChild(side);
    view.appendChild(grid);
  },
});

/* 转盘选项管理 */
function dishManager(){
  const body = el("div");
  const input = el("input", {class: "input", placeholder: "加一个选项，回车确认（留空则从食谱库随机加 3 个）"});
  input.addEventListener("keydown", e => {
    if(e.key === "Enter" && input.value.trim()){
      const arr = dishOptions();
      arr.push(input.value.trim());
      WB.store.set("dishOptions", arr);
      input.value = ""; render(); 
    }
  });
  body.appendChild(input);
  const listBox = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px", marginTop: "10px"}});
  function render(){
    listBox.innerHTML = "";
    dishOptions().forEach((name, i) => {
      listBox.appendChild(el("button", {class: "chip plain clickable", text: name + " ×",
        onclick: () => { const arr = dishOptions(); arr.splice(i, 1); WB.store.set("dishOptions", arr); render(); }}));
    });
    if(!dishOptions().length) listBox.appendChild(el("span", {class: "small faint", text: "空啦，加几个或从食谱库抽"}));
  }
  render();
  body.appendChild(listBox);
  body.appendChild(el("button", {class: "btn sm", style: {marginTop: "10px"}, text: "🎲 从内置食谱库随机加 3 个",
    onclick: () => {
      const arr = dishOptions();
      const pool = WB.content.RECIPES.map(r => r.name).filter(n => !arr.includes(n));
      WB.shuffle(pool).slice(0, 3).forEach(n => arr.push(n));
      WB.store.set("dishOptions", arr);
      render();
    }}));
  WB.ui.modal({title: "转盘选项管理", icon: "plate", content: body,
    actions: [{label: "完成", primary: true, onClick: () => WB.router.render()}]});
}

WB.fun = {spinWheel, petModal};
})();

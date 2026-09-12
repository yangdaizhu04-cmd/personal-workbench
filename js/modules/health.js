/* modules/health.js —— 健康小屋：体重/睡眠默认指标 + 自定义扩展指标，ECharts 趋势图 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const health = WB.collection("health"); // {date, key, value}
let charts = [];

function defs(){
  return WB.store.get("healthDefs", [
    {key: "weight", name: "体重", unit: "kg"},
    {key: "sleep", name: "睡眠时长", unit: "h"},
  ]);
}
function setDefs(d){ WB.store.set("healthDefs", d); }

function addModal(){
  const body = el("div");
  const name = el("input", {class: "input", placeholder: "指标名，如：步数 / 心率 / 血压"});
  const unit = el("input", {class: "input", placeholder: "单位，如：步 / bpm / mmHg", style: {marginTop: "8px"}});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "新指标名称"}), name));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "单位"}), unit));
  const m = WB.ui.modal({title: "自定义指标", icon: "heart", content: body,
    actions: [{label: "添加", primary: true, onClick: () => {
      const n = name.value.trim();
      if(!n){ name.focus(); return; }
      const d = defs();
      const key = "m" + Date.now().toString(36);
      d.push({key, name: n, unit: unit.value.trim()});
      setDefs(d);
      m.close(); WB.router.render();
    }}]});
  setTimeout(() => name.focus(), 60);
}

WB.registerModule({
  id: "health",
  title: "健康小屋",
  icon: "heart",
  sub: () => "数据完全本地 · 只为看见自己",

  render(view){
    disposeCharts();
    const D = defs();
    const days = [];
    const today = WB.bizDate();
    for(let i = 29; i >= 0; i--) days.push(WB.addDaysStr(today, -i));

    /* 顶部：今日速录 */
    const card = el("div", {class: "card", style: {marginBottom: "14px"}});
    card.appendChild(el("div", {class: "card-title", html: icon("heart", 18) + "<span>今天记一笔</span>",
      onclick: () => {}}));
    card.querySelector(".card-title").appendChild(el("button", {class: "btn sm", style: {marginLeft: "auto"},
      html: icon("plus", 13) + "<span>自定义指标</span>", onclick: addModal}));
    const row = el("div", {class: "row", style: {flexWrap: "wrap", gap: "12px"}});
    D.forEach(d => {
      const ex = health.all().find(x => x.date === today && x.key === d.key);
      const input = el("input", {type: "number", class: "input", placeholder: d.unit, step: "any",
        value: ex ? ex.value : "", style: {width: "110px"}});
      const saved = el("span", {class: "small", style: {color: "var(--ok)", opacity: 0, transition: "opacity .3s"}, text: "已记 ✓"});
      input.addEventListener("change", () => {
        const v = parseFloat(input.value);
        const all = health.all().find(x => x.date === today && x.key === d.key);
        if(isNaN(v)){ return; }
        if(all) health.update(all.id, {value: v});
        else health.add({date: today, key: d.key, value: v});
        saved.style.opacity = 1;
        setTimeout(() => saved.style.opacity = 0, 1600);
        WB.router.render();
      });
      row.appendChild(el("div", {class: "col", style: {gap: "3px"}},
        el("label", {class: "small muted", text: d.name + "（" + d.unit + "）"}),
        el("div", {class: "row", style: {gap: "6px"}}, input, saved)));
    });
    card.appendChild(row);
    view.appendChild(card);

    /* 趋势图 */
    if(!health.all().length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("heart", "还没有健康数据",
        "体重、睡眠…每天一个数字，坚持 30 天就能看见趋势")));
      return;
    }

    const grid = el("div", {class: "grid grid-2", style: {alignItems: "start"}});
    view.appendChild(grid);
    const A = () => {
      const cs = getComputedStyle(document.documentElement);
      return {
        ink3: cs.getPropertyValue("--ink-3").trim(),
        accent: cs.getPropertyValue("--accent").trim(),
        accent2: cs.getPropertyValue("--accent-2").trim(),
        split: cs.getPropertyValue("--card-border").trim(),
      };
    };
    D.forEach(d => {
      const data = days.map(ds => {
        const r = health.all().find(x => x.date === ds && x.key === d.key);
        return r ? r.value : null;
      });
      if(!data.some(v => v != null)) return;
      const a = A();
      const div = el("div", {style: {width: "100%", height: "240px"}});
      const cardEl = el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("trend-up", 17) + "<span>" + d.name + "（近 30 天 · " + d.unit + "）</span>"}),
        div);
      grid.appendChild(cardEl);
      const inst = echarts.init(div);
      charts.push(inst);
      const vals = data.filter(v => v != null);
      const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      inst.setOption({
        grid: {left: 44, right: 14, top: 20, bottom: 26},
        tooltip: {trigger: "axis"},
        xAxis: {type: "category", data: days.map(x => x.slice(5)), axisLabel: {color: a.ink3, fontSize: 10}, axisLine: {lineStyle: {color: a.split}}},
        yAxis: {type: "value", min: Math.floor(min - (max - min || 1) * .3), max: Math.ceil(max + (max - min || 1) * .3),
          axisLabel: {color: a.ink3, fontSize: 10}, splitLine: {lineStyle: {color: a.split}}},
        series: [{type: "line", data, connectNulls: true, smooth: true, symbolSize: 5,
          lineStyle: {color: a.accent, width: 2.5}, itemStyle: {color: a.accent},
          areaStyle: {color: {type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            {offset: 0, color: a.accent + "44"}, {offset: 1, color: a.accent + "05"}]}}}],
      });
    });

    /* 指标管理（删除自定义指标） */
    const mgmt = el("div", {class: "row", style: {marginTop: "12px", flexWrap: "wrap", gap: "6px"}});
    mgmt.appendChild(el("span", {class: "small faint"}, "指标管理："));
    D.forEach(d => {
      mgmt.appendChild(el("button", {class: "chip plain clickable", text: d.name + " ×",
        title: "删除该指标（历史数据保留在本地）",
        onclick: () => setDefs(defs().filter(x => x.key !== d.key)) & WB.router.render()}));
    });
    view.appendChild(mgmt);
  },
});
function disposeCharts(){ charts.forEach(c => { try{ c.dispose(); }catch(e){} }); charts = []; }
})();

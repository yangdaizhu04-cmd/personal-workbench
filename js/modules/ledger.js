/* modules/ledger.js —— 简单记账：支出/收入、自定义分类、总预算+分类预算、月汇总 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const ledger = WB.collection("ledger");
const cats = WB.collection("ledgerCats");
const DEFAULT_CATS = [
  {name: "餐饮", kind: "out", icon: "plate", color: "#dd9a84"},
  {name: "交通", kind: "out", icon: "external", color: "#7fa3bd"},
  {name: "购物", kind: "out", icon: "gift", color: "#b9aade"},
  {name: "娱乐", kind: "out", icon: "gamepad", color: "#d4b076"},
  {name: "其他", kind: "out", icon: "circle", color: "#a8a08f"},
];

function ensureCats(){
  if(!cats.all().length) DEFAULT_CATS.forEach(c => cats.add(c));
}
function catOf(id){ return cats.all().find(c => c.id === id) || null; }
function monthOf(s){ return s.slice(0, 7); }

function budgets(){
  return WB.store.get("ledgerBudgets", {total: 0, cats: {}});
}
function setBudgets(b){ WB.store.set("ledgerBudgets", b); }

/* ---- 记一笔弹窗（总览快速记账也调用） ---- */
function quickAdd(preset){
  ensureCats();
  const t = Object.assign({type: "out", amount: "", catId: cats.all()[0] && cats.all()[0].id, date: WB.bizDate(), note: ""}, preset || {});
  const body = el("div");
  const typeSeg = el("div", {class: "seg"});
  let curType = t.type;
  [["out", "支出"], ["in", "收入"]].forEach(([v, l]) => typeSeg.appendChild(el("button", {
    class: v === curType ? "on" : "", text: l, dataset: {v},
    onclick: () => { curType = v; typeSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); paintCats(); },
  })));
  const amount = el("input", {type: "number", class: "input", placeholder: "金额", min: 0, step: "0.01",
    style: {fontSize: "20px", textAlign: "center"}});
  amount.value = t.amount;
  const catGrid = el("div", {style: {display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", margin: "10px 0"}});
  let curCat = t.catId;
  const paintCats = () => {
    catGrid.innerHTML = "";
    cats.all().filter(c => c.kind === curType).forEach(c => {
      catGrid.appendChild(el("button", {
        class: "center col", text: c.name,
        style: {padding: "10px 4px", borderRadius: "12px", fontSize: "13px", gap: "4px",
          background: curCat === c.id ? WB.hexToRgba(c.color || "#7fa3bd", .18) : "var(--card-2)",
          border: curCat === c.id ? "1.5px solid " + (c.color || "var(--accent)") : "1px solid var(--card-border)"},
        onclick: e => { curCat = c.id; paintCats(); },
      }));
    });
    catGrid.appendChild(el("button", {class: "center", text: "＋",
      style: {padding: "10px 4px", borderRadius: "12px", color: "var(--ink-3)", background: "var(--card-2)", border: "1px dashed var(--card-border)"},
      onclick: () => catManager()}));
  };
  const dateIn = el("input", {type: "date", class: "input", value: t.date});
  const noteIn = el("input", {class: "input", placeholder: "备注（可选）", value: t.note});
  paintCats();
  body.appendChild(el("div", {class: "field"}, el("label", {text: "类型"}), typeSeg));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "金额"}), amount));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "分类"}), catGrid));
  body.appendChild(el("div", {class: "field-row"},
    el("div", {class: "field"}, el("label", {text: "日期"}), dateIn),
    el("div", {class: "field"}, el("label", {text: "备注"}), noteIn)));

  const m = WB.ui.modal({
    title: "记一笔", icon: "wallet", content: body,
    actions: [{label: "保存", primary: true, onClick: () => {
      const amt = parseFloat(amount.value);
      if(!(amt > 0)){ amount.focus(); return; }
      ledger.add({type: curType, amount: amt, catId: curCat, date: dateIn.value || WB.bizDate(), note: noteIn.value.trim()});
      m.close(); WB.ui.toast("已记账 " + (curType === "out" ? "-" : "+") + "¥" + amt);
      WB.router.render();
      checkBudgetWarn();
    }}],
  });
  setTimeout(() => amount.focus(), 60);
}

/* 预算温和提醒 */
function checkBudgetWarn(){
  const b = budgets();
  if(!b.total) return;
  const month = WB.monthStr(new Date());
  const spent = ledger.all().filter(l => l.type === "out" && monthOf(l.date) === month).reduce((s, l) => s + l.amount, 0);
  const ratio = spent / b.total;
  const key = "budgetWarned:" + month;
  const warned = WB.store.get(key, {});
  if(ratio >= 1 && !warned.full){ warned.full = true; WB.store.set(key, warned); WB.ui.toast("本月支出已超预算，温柔地注意一下下 💛", "warn"); }
  else if(ratio >= .8 && !warned.eighty){ warned.eighty = true; WB.store.set(key, warned); WB.ui.toast("本月预算已用 80%，稳住节奏"); }
}

/* ---- 分类/预算管理 ---- */
function catManager(){
  ensureCats();
  const body = el("div");
  const b = budgets();
  const totalIn = el("input", {type: "number", class: "input", value: b.total || "", min: 0, placeholder: "0 表示不设总预算"});
  body.appendChild(el("div", {class: "field"}, el("label", {text: "每月总预算"}), totalIn));

  body.appendChild(el("div", {class: "small muted", style: {margin: "8px 0 4px"}, text: "分类支出预算（留空不设）："}));
  const rows = el("div", {class: "col", style: {gap: "6px"}});
  cats.all().filter(c => c.kind === "out").forEach(c => {
    const input = el("input", {type: "number", class: "input", placeholder: "不限", min: 0,
      value: (b.cats || {})[c.id] || "", style: {width: "110px"}});
    input.addEventListener("change", () => {
      const bb = budgets();
      bb.cats = bb.cats || {};
      if(input.value) bb.cats[c.id] = parseFloat(input.value);
      else delete bb.cats[c.id];
      setBudgets(bb);
    });
    rows.appendChild(el("div", {class: "row"},
      el("span", {class: "prio-dot", style: {background: c.color || "var(--accent)"}}),
      el("span", {class: "grow", text: c.name}), input));
  });
  body.appendChild(rows);

  /* 新增分类 */
  const newRow = el("div", {class: "row", style: {marginTop: "12px"}});
  const nameIn = el("input", {class: "input grow", placeholder: "新分类名称"});
  const kindSeg = el("div", {class: "seg"});
  let newKind = "out";
  [["out", "支出"], ["in", "收入"]].forEach(([v, l]) => kindSeg.appendChild(el("button", {
    class: v === newKind ? "on" : "", text: l, dataset: {v},
    onclick: e => { newKind = v; kindSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === v)); },
  })));
  newRow.appendChild(nameIn); newRow.appendChild(kindSeg);
  newRow.appendChild(el("button", {class: "btn sm primary", text: "添加", onclick: () => {
    const name = nameIn.value.trim();
    if(!name) return;
    cats.add({name, kind: newKind, color: "#7fa3bd"});
    nameIn.value = ""; WB.router.render(); setTimeout(catManager, 60);
  }}));
  body.appendChild(newRow);

  /* 删除分类 */
  const delRow = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px", marginTop: "10px"}});
  cats.all().forEach(c => {
    delRow.appendChild(el("button", {class: "chip plain clickable", text: c.name + " ×",
      onclick: () => {
        cats.remove(c.id);
        WB.ui.toast("分类「" + c.name + "」已删（原账单保留分类 ID）");
        WB.router.render(); setTimeout(catManager, 60);
      }}));
  });
  body.appendChild(el("div", {class: "small faint", style: {margin: "10px 0 4px"}, text: "点按删除分类："}));
  body.appendChild(delRow);

  WB.ui.modal({title: "预算与分类", icon: "wallet", content: body,
    actions: [{label: "完成", primary: true, onClick: () => {
      const bb = budgets();
      bb.total = parseFloat(totalIn.value) || 0;
      setBudgets(bb);
      WB.router.render();
    }}]});
}

WB.registerModule({
  id: "ledger",
  title: "简单记账",
  icon: "wallet",
  sub: function(){
    const month = WB.monthStr(new Date());
    const out = ledger.all().filter(l => l.type === "out" && monthOf(l.date) === month).reduce((s, l) => s + l.amount, 0);
    return "本月支出 ¥" + out.toFixed(2).replace(/\.00$/, "");
  },

  render(view){
    ensureCats();
    let ym = WB.monthStr(new Date());
    const state = {ym};

    const bar = el("div", {class: "row", style: {marginBottom: "14px", flexWrap: "wrap", gap: "8px"}});
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-left", 14), onclick: () => { state.ym = shift(state.ym, -1); paint(); }}));
    bar.appendChild(el("span", {class: "chip", id: "led-ym"}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("chev-right", 14), onclick: () => { state.ym = shift(state.ym, 1); paint(); }}));
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn sm", html: icon("settings", 14) + "<span>预算/分类</span>", onclick: catManager}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>记一笔</span>", onclick: () => quickAdd()}));
    view.appendChild(bar);

    const summary = el("div", {class: "grid grid-3", style: {marginBottom: "14px"}});
    view.appendChild(summary);
    const listCard = el("div", {class: "card"});
    view.appendChild(listCard);

    function shift(s, n){
      const [y, m] = s.split("-").map(Number);
      return WB.monthStr(new Date(y, m - 1 + n, 1));
    }
    function paint(){
      const ym = state.ym;
      bar.querySelector("#led-ym").textContent = ym.replace("-", " 年 ") + " 月";
      const arr = ledger.all().filter(l => monthOf(l.date) === ym).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      const out = arr.filter(l => l.type === "out").reduce((s, l) => s + l.amount, 0);
      const inn = arr.filter(l => l.type === "in").reduce((s, l) => s + l.amount, 0);
      summary.innerHTML = "";
      const b = budgets();
      const budgetCell = el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("archive", 17) + "<span>预算</span>"}));
      if(b.total > 0){
        const pct = Math.min(100, Math.round(out / b.total * 100));
        budgetCell.appendChild(el("div", {class: "row", style: {marginBottom: "6px"}},
          el("span", {class: "small muted", text: "¥" + out.toFixed(0) + " / ¥" + b.total})));
        budgetCell.appendChild(el("div", {class: "bar" + (pct >= 80 ? " warm" : "")}, el("i", {style: {width: pct + "%"}})));
        budgetCell.appendChild(el("div", {class: "small " + (pct >= 80 ? "" : "faint"), style: {marginTop: "4px"},
          text: "已用 " + pct + "%"}));
      }else budgetCell.appendChild(el("div", {class: "small faint", text: "未设总预算，去「预算/分类」设置"}));
      summary.appendChild(budgetCell);
      summary.appendChild(el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("trend-up", 17) + "<span>支出</span>"}),
        el("div", {style: {fontSize: "26px", fontWeight: "600"}}, "¥" + out.toFixed(2).replace(/\.00$/, ""))));
      summary.appendChild(el("div", {class: "card"},
        el("div", {class: "card-title", html: icon("download", 17) + "<span>收入</span>"}),
        el("div", {style: {fontSize: "26px", fontWeight: "600", color: "var(--ok)"}}, "¥" + inn.toFixed(2).replace(/\.00$/, ""))));

      /* 分类小汇 */
      if(arr.length){
        const byCat = {};
        arr.filter(l => l.type === "out").forEach(l => {
          const c = catOf(l.catId);
          const key = c ? c.name : "其他";
          byCat[key] = (byCat[key] || 0) + l.amount;
        });
        const chips = el("div", {class: "row", style: {flexWrap: "wrap", gap: "6px", marginTop: "10px"}});
        Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([name, v]) => {
          chips.appendChild(el("span", {class: "chip plain", text: name + " ¥" + v.toFixed(0)}));
        });
        budgetCell.appendChild(chips);
      }

      /* 列表 */
      listCard.innerHTML = "";
      listCard.className = "card";
      listCard.appendChild(el("div", {class: "card-title", html: icon("list", 18) + "<span>账单明细</span><span class='card-sub'>" + arr.length + " 笔</span>"}));
      if(!arr.length){
        listCard.appendChild(WB.ui.emptyState("wallet", thisMonthText(ym), "点右上角「记一笔」，或去总览快速记账"));
        return;
      }
      const list = el("div", {class: "list"});
      arr.forEach(l => {
        const c = catOf(l.catId);
        list.appendChild(el("div", {class: "list-row"},
          el("span", {class: "center", html: icon((c && c.icon) || "circle", 17),
            style: {width: "34px", height: "34px", borderRadius: "11px", background: WB.hexToRgba((c && c.color) || "#a8a08f", .15),
              color: (c && c.color) || "var(--ink-2)", flex: "none"}}),
          el("div", {class: "grow", style: {minWidth: 0}},
            el("div", {text: l.note || (c ? c.name : "记账")}),
            el("div", {class: "small faint", text: l.date + " · " + (c ? c.name : "未分类")})),
          el("b", {style: {color: l.type === "out" ? "var(--ink)" : "var(--ok)"},
            text: (l.type === "out" ? "-" : "+") + "¥" + l.amount.toFixed(2).replace(/\.00$/, "")}),
          el("button", {class: "icon-btn", html: icon("trash", 14), title: "删除", onclick: () => {
            ledger.remove(l.id);     // 撤销条由 02-store.js 的 toTrash 统一弹
            WB.router.render();
          }})));
      });
      listCard.appendChild(list);
    }
    function thisMonthText(ym){ return ym === WB.monthStr(new Date()) ? "这个月还没有账单" : ym + " 没有账单"; }
    paint();
  },

  quickAdd,
});
WB.ledger = {quickAdd};
})();

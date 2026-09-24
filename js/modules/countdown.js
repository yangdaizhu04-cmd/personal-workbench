/* modules/countdown.js —— 倒数日/纪念日：阳历+农历生日、每年重复、提前提醒 */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});
const { el, icon, esc } = WB;
const countdowns = WB.collection("countdowns");

function targetOf(c, today){
  let target = c.date;
  if(c.lunar && c.repeatYearly){
    target = WB.cal.nextLunarBirthday(c.lunar.lMonth, c.lunar.lDay) || c.date;
  }else if(c.repeatYearly){
    const y = new Date().getFullYear();
    let t = y + c.date.slice(4);
    if(t < today) t = (y + 1) + c.date.slice(4);
    target = t;
  }
  return target;
}

function itemModal(existing){
  const isNew = !existing;
  const c = Object.assign({
    name: "", date: WB.addDaysStr(WB.bizDate(), 30), repeatYearly: false,
    isBirthday: false, lunarOn: false, lunarMonth: 1, lunarDay: 1, note: "",
  }, existing ? JSON.parse(JSON.stringify(existing)) : {});
  const body = el("div");
  const name = el("input", {class: "input", value: c.name, placeholder: "名称，如：妈妈生日 / 出发去云南"});
  const dateIn = el("input", {type: "date", class: "input", value: c.date});
  const repT = el("label", {class: "switch"});
  const repC = Object.assign(el("input", {type: "checkbox"}), {checked: !!c.repeatYearly});
  repT.append(repC, el("span", {class: "track"}), el("span", {class: "thumb"}));

  /* 农历（生日用） */
  const lunarRow = el("div", {class: "field"});
  const lunarOn = Object.assign(el("input", {type: "checkbox"}), {checked: !!c.lunarOn});
  lunarOn.addEventListener("change", () => { lunarFields.style.display = lunarOn.checked ? "" : "none"; });
  const lunarFields = el("div", {class: "field-row", style: {marginTop: "8px", display: c.lunarOn ? "" : "none"}});
  const lm = el("select", {class: "input"}, Array.from({length: 12}, (_, i) => el("option", {value: i + 1, text: (i + 1) + " 月", selected: c.lunarMonth === i + 1})));
  const ld = el("select", {class: "input"}, Array.from({length: 30}, (_, i) => el("option", {value: i + 1, text: solarlunar.toChinaDay(i + 1), selected: c.lunarDay === i + 1})));
  lunarFields.append(el("div", {class: "field"}, el("label", {text: "农历月"}), lm),
                     el("div", {class: "field"}, el("label", {text: "农历日"}), ld));
  lunarRow.appendChild(el("label", {class: "row", style: {gap: "10px"}}, lunarOn,
    el("span", {}, "按农历记（生日推荐）"),
    el("span", {class: "small faint", text: "选了农历会忽略上面的公历日期"})));
  lunarRow.appendChild(lunarFields);
  lunarOn.addEventListener("change", () => { repC.checked = lunarOn.checked ? true : repC.checked; });

  body.appendChild(el("div", {class: "field"}, el("label", {text: "名称"}), name));
  body.appendChild(el("div", {class: "field"}, el("label", {text: "公历日期"}), dateIn));
  body.appendChild(el("div", {class: "field"},
    el("label", {text: "每年重复"}),
    el("label", {class: "row", style: {gap: "10px"}}, repT, el("span", {text: "生日、纪念日都选这个"}))));
  body.appendChild(lunarRow);

  const m = WB.ui.modal({
    title: isNew ? "新的倒数日" : "编辑", icon: "hourglass", content: body,
    actions: [
      ...(isNew ? [] : [{label: "删除", danger: true, onClick: () => {
        // 删完给撤销条兜底（回收站 30 天），不再拦一次确认
        countdowns.remove(c.id); m.close(); WB.router.render();
        return true;
      }}]),
      {label: "保存", primary: true, onClick: () => {
        const nv = name.value.trim();
        if(!nv){ name.focus(); return; }
        const patch = {
          name: nv, date: dateIn.value || WB.bizDate(), repeatYearly: repC.checked || lunarOn.checked,
          lunarOn: lunarOn.checked,
          lunar: lunarOn.checked ? {lMonth: +lm.value, lDay: +ld.value} : null,
        };
        if(isNew) countdowns.add(patch);
        else countdowns.update(c.id, patch);
        m.close(); WB.router.render();
      }},
    ],
  });
  setTimeout(() => name.focus(), 60);
}

WB.registerModule({
  id: "countdown",
  title: "倒数日",
  icon: "hourglass",
  sub: () => "值得期待的日子",

  render(view){
    const today = WB.bizDate();
    const bar = el("div", {class: "row", style: {marginBottom: "14px"}});
    bar.appendChild(el("div", {class: "muted small"}, "生日支持农历 · 已过的显示「已 X 天」"));
    bar.appendChild(el("span", {class: "grow"}));
    bar.appendChild(el("button", {class: "btn primary sm", html: icon("plus", 14) + "<span>添加倒数日</span>", onclick: () => itemModal(null)}));
    view.appendChild(bar);

    /* 下个假期 */
    const hol = WB.cal.nextHoliday();
    if(hol){
      view.appendChild(el("div", {class: "card", style: {marginBottom: "14px", background: "linear-gradient(135deg, var(--accent-soft), var(--accent2-soft))"}},
        el("div", {class: "row"},
          el("span", {style: {fontSize: "28px"}, text: "🏖"}),
          el("div", {class: "grow", style: {marginLeft: "10px"}},
            el("div", {style: {fontWeight: "600"}}, hol.name),
            el("div", {class: "small muted", text: WB.fmtDateCN(hol.start, true) + " 开始，连休 " + hol.days + " 天"}),
            hol.remain <= WB.theme.get("birthdayAhead") && hol.remain > 0 ?
              el("div", {class: "small", style: {color: "var(--accent)"}, text: "快了！还有 " + hol.remain + " 天"}): null),
          el("div", {style: {fontSize: "26px", fontWeight: "600"}},
            hol.remain === 0 ? "今天！" : hol.remain + " 天"))));
    }

    const arr = countdowns.all().map(c => {
      const target = targetOf(c, today);
      return Object.assign({}, c, {target, diff: WB.daysBetween(today, target)});
    }).sort((a, b) => a.diff - b.diff);

    if(!arr.length){
      view.appendChild(el("div", {class: "card"}, WB.ui.emptyState("hourglass", "还没有倒数日",
        "生日、纪念日、假期出发日…<br>有盼头的日子过得更快")));
      return;
    }

    const grid = el("div", {class: "grid grid-3", style: {alignItems: "start"}});
    arr.forEach(c => {
      const past = c.diff < 0;
      const soon = !past && c.diff <= (WB.theme.get("birthdayAhead") || 7);
      const card = el("div", {class: "card hoverable", style: past ? {opacity: .75} : {}},
        el("div", {class: "row", style: {alignItems: "flex-start"}},
          el("div", {class: "grow", style: {minWidth: 0}},
            el("div", {style: {fontWeight: "600"}, text: (c.isBirthday ? "🎂 " : "") + c.name}),
            el("div", {class: "small faint", style: {marginTop: "2px"}},
              WB.fmtDateCN(c.target) + (c.lunarOn ? " · 农历" + solarlunar.toChinaDay(c.lunar.lDay) : "") + (c.repeatYearly ? " · 每年" : ""))),
          el("button", {class: "icon-btn", html: icon("edit", 14), onclick: () => itemModal(c)})),
        el("div", {class: "row", style: {marginTop: "10px", alignItems: "baseline"}},
          el("span", {style: {fontSize: "26px", fontWeight: "600",
            color: past ? "var(--ink-3)" : soon ? "var(--accent)" : "var(--ink)"}},
            past ? "已 " + Math.abs(c.diff) + " 天" : c.diff === 0 ? "就是今天" : c.diff + " 天"),
          c.isBirthday && !past ? el("span", {class: "small muted", style: {marginLeft: "8px"}},
            "别忘了准备祝福") : null));
      grid.appendChild(card);
    });
    view.appendChild(grid);
  },
});

/* targetOf 要对外：桌面版后台提醒要算「下一个生日/纪念日是哪天」，
   农历换算与每年重复的规则只能有一份（复制一份出来两边迟早不一致） */
WB.countdown = {targetOf};
})();

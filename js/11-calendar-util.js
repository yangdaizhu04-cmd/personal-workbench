/* 11-calendar-util.js —— 节假日班休 / 农历 / 节气 / 月相 / 倒数日
   依赖：vendor/solarlunar.min.js（全局 solarlunar）、WB.utils */
(function(){
"use strict";
const WB = (window.WB = window.WB || {});

/* ---------- 法定节假日班休表（官方公布后补录即可） ----------
   2025：官方公布，确定。
   2026：2025-11 官方公布口径录入，个别连休边界为整理值，如有出入直接改这里。
   2027：尚未公布，留空。 */
const HOLIDAY_RANGES = [
  {name:"元旦",     year:2025, start:"01-01", end:"01-01", work:[]},
  {name:"春节",     year:2025, start:"01-28", end:"02-04", work:["2025-01-26","2025-02-08"]},
  {name:"清明节",   year:2025, start:"04-04", end:"04-06", work:[]},
  {name:"劳动节",   year:2025, start:"05-01", end:"05-05", work:["2025-04-27"]},
  {name:"端午节",   year:2025, start:"05-31", end:"06-02", work:[]},
  {name:"国庆节·中秋", year:2025, start:"10-01", end:"10-08", work:["2025-09-28","2025-10-11"]},
  {name:"元旦",     year:2026, start:"01-01", end:"01-03", work:[]},
  {name:"春节",     year:2026, start:"02-15", end:"02-22", work:["2026-02-14","2026-02-28"]},
  {name:"清明节",   year:2026, start:"04-04", end:"04-06", work:[]},
  {name:"劳动节",   year:2026, start:"05-01", end:"05-05", work:["2026-04-26"]},
  {name:"端午节",   year:2026, start:"06-19", end:"06-21", work:[]},
  {name:"中秋节",   year:2026, start:"09-25", end:"09-27", work:[]},
  {name:"国庆节",   year:2026, start:"10-01", end:"10-07", work:[]},
];
const holidayMap = {};
HOLIDAY_RANGES.forEach(r => {
  let d = WB.parseDate(r.year + "-" + r.start);
  const end = WB.parseDate(r.year + "-" + r.end);
  while(d <= end){
    holidayMap[WB.dateStr(d)] = {type:"休", name:r.name};
    d = WB.addDays(d, 1);
  }
  r.work.forEach(w => holidayMap[w] = {type:"班", name:r.name});
});

/* ---------- 公历节日 ---------- */
const SOLAR_FEST = {
  "01-01":"元旦", "02-14":"情人节", "03-08":"妇女节", "03-12":"植树节", "04-01":"愚人节",
  "05-01":"劳动节", "05-04":"青年节", "06-01":"儿童节", "07-01":"建党节", "08-01":"建军节",
  "09-10":"教师节", "10-01":"国庆节", "10-24":"程序员节", "12-24":"平安夜", "12-25":"圣诞节", "12-31":"跨年夜",
};
/* ---------- 农历节日 ---------- */
const LUNAR_FEST = {"1-1":"春节","1-15":"元宵节","2-2":"龙抬头","5-5":"端午节","7-7":"七夕","7-15":"中元节","8-15":"中秋节","9-9":"重阳节","12-8":"腊八节","12-23":"小年"};
const LUNAR_FEST_LASTDAY = {"1-1":"除夕"};

/* ---------- 节气寄语（24 节气温柔一句） ---------- */
const TERM_TIPS = {
  "立春":"今日立春，东风解冻，万物开始想你", "雨水":"今日雨水，好雨知时节，记得带伞",
  "惊蛰":"今日惊蛰，春雷响了，去见想见的人吧", "春分":"今日春分，昼夜均而寒暑平",
  "清明":"今日清明，风清景明，适合想念", "谷雨":"今日谷雨，雨生百谷，春天最后一个节气",
  "立夏":"今日立夏，万物至此皆长大", "小满":"今日小满，将满未满，人生最好的状态",
  "芒种":"今日芒种，有芒之谷可种，忙碌也要吃饭", "夏至":"今日夏至，白昼最长，光明最多的一天",
  "小暑":"今日小暑，温风至，西瓜与凉席准备好了吗", "大暑":"今日大暑，热极而衰，秋天在路上了",
  "立秋":"今日立秋，一叶知秋，凉风有信", "处暑":"今日处暑，暑气至此而止",
  "白露":"今日白露，天凉加衣，晚上盖好被子", "秋分":"今日秋分，秋色平分，昼夜等长",
  "寒露":"今日寒露，露气寒冷，早晚添件外套", "霜降":"今日霜降，气肃而凝，露结为霜",
  "立冬":"今日立冬，万物收藏，记得吃口热的", "小雪":"今日小雪，初雪将至，围巾准备好了吗",
  "大雪":"今日大雪，至此而雪盛，注意保暖", "冬至":"今日冬至，白昼最短，饺子汤圆都要吃",
  "小寒":"今日小寒，天渐寒，尚未大冷", "大寒":"今日大寒，寒极必暖，静待春归",
};

/* ---------- 月相 ---------- */
const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // 已知新月历元
const MOON_PHASES = [
  [1.85, "新月", "🌙", "一切重新开始的一天"], [6.4, "娥眉月", "🌒", "愿望正在发芽"],
  [8.4, "上弦月", "🌓", "推进到一半，别急"], [13.8, "盈凸月", "🌔", "接近圆满，再坚持一下"],
  [15.8, "满月", "🌕", "圆满之夜，适合复盘与感谢"], [21.1, "亏凸月", "🌖", "慢慢收束，保存能量"],
  [23.1, "下弦月", "🌗", "做减法的时刻"], [28.6, "残月", "🌘", "让该过去的过去"],
];
function moonOf(dateStr){
  const d = WB.parseDate(dateStr);
  const noon = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000;
  let age = (noon - NEW_MOON) % SYNODIC;
  if(age < 0) age += SYNODIC;
  for(const [limit, name, icon, tip] of MOON_PHASES){
    if(age < limit) return {name, icon, tip, age};
  }
  return {name:"新月", icon:"🌙", tip:"一切重新开始的一天", age};
}

/* ---------- 节气（含区间，非节气当天显示"当前节气"） ---------- */
const TERM_NAMES = ["小寒","大寒","立春","雨水","惊蛰","春分","清明","谷雨","立夏","小满","芒种","夏至",
                    "小暑","大暑","立秋","处暑","白露","秋分","寒露","霜降","立冬","小雪","大雪","冬至"];
function termOf(dateStr){
  const d = WB.parseDate(dateStr);
  const y = d.getFullYear();
  // 第 n 个节气（1=小寒…24=冬至）落在当年第 ceil(n/2) 月
  const dayOfTerm = (year, n) => {
    const v = solarlunar.getTerm(year, n);
    if(v < 0) return null;
    const m = Math.ceil(n / 2);
    return WB.parseDate(year + "-" + String(m).padStart(2, "0") + "-" + String(v).padStart(2, "0"));
  };
  let cur = null;
  for(let n = 1; n <= 24; n++){
    const td = dayOfTerm(y, n);
    if(!td) continue;
    if(td <= d) cur = {name: TERM_NAMES[n - 1], date: WB.dateStr(td)};
    else break;
  }
  if(!cur){ // 1 月初：去年的冬至
    const v = solarlunar.getTerm(y - 1, 24);
    cur = {name:"冬至", date: (y - 1) + "-12-" + String(v).padStart(2, "0")};
  }
  const isTermDay = cur.date === dateStr;
  return {name: cur.name, date: cur.date, isTermDay, tip: TERM_TIPS[cur.name] || ""};
}

/* ---------- 农历 / 节日 ---------- */
function lunarOf(dateStr){
  const d = WB.parseDate(dateStr);
  try{ return solarlunar.solar2lunar(d.getFullYear(), d.getMonth() + 1, d.getDate()); }catch(e){ return null; }
}
function festivalOf(dateStr){
  const md = dateStr.slice(5);
  const lunar = lunarOf(dateStr);
  let name = SOLAR_FEST[md] || "";
  if(lunar){
    if(LUNAR_FEST[lunar.lMonth + "-" + lunar.lDay]) name = name || LUNAR_FEST[lunar.lMonth + "-" + lunar.lDay];
    // 除夕：明天是正月初一
    const next = lunarOf(WB.addDaysStr(dateStr, 1));
    if(next && next.lMonth === 1 && next.lDay === 1) name = name || "除夕";
  }
  const term = termOf(dateStr);
  if(!name && term.isTermDay) name = term.name;
  return name;
}

/* ---------- 班休 / 下个假期 ---------- */
function holidayOf(dateStr){ return holidayMap[dateStr] || null; }
function nextHoliday(){
  const today = WB.bizDate();
  // 找今天及以后第一个连续"休"段
  let d = WB.parseDate(today);
  const end = WB.addDays(d, 400);
  while(d <= end){
    const s = WB.dateStr(d);
    if(holidayMap[s] && holidayMap[s].type === "休"){
      const name = holidayMap[s].name;
      let e = d, len = 0;
      while(holidayMap[WB.dateStr(e)] && holidayMap[WB.dateStr(e)].type === "休" && holidayMap[WB.dateStr(e)].name === name){
        len++; e = WB.addDays(e, 1);
      }
      return {name, start: s, days: len, remain: WB.daysBetween(today, s)};
    }
    d = WB.addDays(d, 1);
  }
  return null;
}

/* ---------- 农历生日 → 下一个公历日期 ---------- */
function nextLunarBirthday(lMonth, lDay, leapOk){
  const today = WB.bizDate();
  const thisYear = new Date().getFullYear();
  for(let y = thisYear; y <= thisYear + 2; y++){
    try{
      const sol = solarlunar.lunar2solar(y, lMonth, lDay, false);
      if(sol && sol.cYear){
        const s = sol.cYear + "-" + String(sol.cMonth).padStart(2, "0") + "-" + String(sol.cDay).padStart(2, "0");
        if(s >= today) return s;
      }
    }catch(e){}
  }
  return null;
}

WB.cal = {HOLIDAY_RANGES, holidayOf, nextHoliday, lunarOf, termOf, moonOf, festivalOf, nextLunarBirthday};
})();

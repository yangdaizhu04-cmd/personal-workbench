/* tests/xss-sinks.test.mjs —— HTML 注入面的静态审计（node --test，零依赖）

   为什么用静态扫描而不是运行时断言：本项目的 WB.el(..., {html}) 是唯一的 HTML 出口，
   而危险与否取决于「插进去的那个表达式是不是用户可控的」—— 运行时很难判定，静态扫一眼就清楚。

   本轮审查抓到的两处 XSS 正是这样漏掉的：清单名（todos.js 的筛选 chip）与健康指标名/单位
   （health.js 的卡片标题）被拼进 html:，而同一个文件里其它渲染点用的是 text: ——
   规则本来是有的，只是那两行没照做（踩坑 #097）。所以这里把规则写成断言，让「忘了」变成测试失败。

   判定口径：html: 的值里每一段「+ 拼接」都必须满足其一
     1) 纯字符串字面量   2) 白名单函数（icon / WB.md.render 等本项目自造的 HTML）   3) 纯标点
   任何标识符（变量、成员访问、函数调用结果）都不放行 —— 要拼就改用 text: 子节点。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS_DIRS = ["js", "js/modules"];

/* 视为安全来源的函数：返回值是本项目自己造的 HTML，不是用户输入 */
/* 视为安全来源的函数：返回值是本项目自己造的 HTML，不是用户输入 */
const SAFE_FN = /^(icon|WB\.icon|WB\.md\.render|md\.render|qr\.createSvgTag|WB\.esc|esc)\(/;
const PRIMS = ["undefined", "null", "true", "false"];
const QUOTES = String.fromCharCode(39, 34, 96);

/* 逐条豁免：键是 文件:行号，值是「为什么这个来源不可能含用户输入」 */
const EXEMPT = {
  "js/01-utils.js:15": "这就是 sink 本身 —— el() 的 html: 分支，WB.el 的安全边界就在这一行",
  "js/06-ui.js:39": "swapIcon 的两个参数都是图标名，值取自 WB.icon 的白名单表",
  "js/06-ui.js:181": "modal 的 content 契约：字符串按 HTML 处理（调用方自负），非字符串走 appendChild",
  "js/06-ui.js:221": "emptyState 的 hint 形参 —— 调用方全传字面量，唯一的动态值是 09-router 传的 esc(e.message)",
  "js/06-ui.js:301": "ring 的 svg 宽高是数字（外层已 clamp 0-100）",
  "js/16-immersive.js:161": "沉浸层 svg 的尺寸，同上：数字",
  "js/07b-custom-theme.js:389": "actionsMenu 的四个字面量 label（自定义主题的按钮名）",
  "js/09-router.js:119": "模块标题来自 registerModule 的字面量 title",
  "js/09-router.js:140": "底部导航 tabs 数组里的字面量 label",
  "js/09-router.js:175": "抽屉里的模块标题，同 119",
  "js/modules/assistant.js:54": "同函数内的静态三元素数组（日报 / 日记 / 复盘三个入口）",
  "js/modules/books.js:64": "固定错误文案（内置书单为空时的提示）",
  "js/modules/books.js:98": "内置书单表（04b-data-content 的静态内容）里的书名与数量",
  "js/modules/calendar.js:119": "WB.fmtDateCN 是本项目的日期格式化，输出只有数字与固定中文",
  "js/modules/journal.js:110": "两个固定文案二选一（编辑 / 开始写）",
  "js/modules/ledger.js:257": "条数（数字）",
  "js/modules/pomodoro.js:184": "两个 emoji 三元二选一",
  "js/modules/pomodoro.js:473": "条数（数字）",
  "js/modules/settings.js:392": "分组数与行数（数字）",
  "js/modules/settings.js:687": "关于页的固定文案（开源组件与许可说明）",
  "js/modules/settings.js:696": "sectionCard 的标题形参 —— 全部调用方传字面量",
  "js/modules/sound.js:501": "showLabel 来自 SRC_META 静态音源表",
  "js/modules/stats.js:13": "卡片标题由调用方写字面量",
  "js/modules/stats.js:398": "WB.icon 白名单",
  "js/modules/today.js:551": "日期串的前四位（年份数字）",
  "js/modules/today.js:649": "条数（数字）",
  "js/modules/todos.js:369": "quads 是同函数内的静态字面量数组（重要且紧急 等四象限）",
  "js/modules/todos.js:584": "条数（数字）",
  "js/modules/wishes.js:123": "年份（数字）",
};

/* 两条规则各自扫描时把命中的豁免键记到这里，最后统一查僵尸条目 */
const usedExempt = new Set();

function jsFiles(){  const out = [];
  for(const dir of JS_DIRS){
    const full = path.join(ROOT, dir);
    if(!fs.existsSync(full)) continue;
    for(const name of fs.readdirSync(full)){
      if(name.endsWith(".js")) out.push(path.join(full, name));
    }
  }
  return out;
}
function isLiteral(p){
  if(PRIMS.includes(p)) return true;
  return p.length > 1 && QUOTES.includes(p[0]) && p.endsWith(p[0]);
}
/** 剥掉字符串字面量与数字后，剩下的部分里若还有标识符字符，就算「含裸标识符」 */
function hasBareIdentifier(s){
  let out = "", i = 0;
  while(i < s.length){
    const c = s[i];
    if(QUOTES.includes(c)){
      i++;
      while(i < s.length && s[i] !== c){ if(s[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return /[A-Za-z_$]/.test(out.replace(/\d+(\.\d+)?/g, ""));
}
/** 把一段拼接表达式拆开，只留「含裸标识符、且不在白名单里」的片段 */
function riskyParts(raw){
  return raw.split("+").map(s => s.trim()).filter(Boolean)
    .filter(p => !SAFE_FN.test(p) && !isLiteral(p) && hasBareIdentifier(p));
}

/** 取出 html: 后面那个表达式的源码（遇顶层逗号或换行即止） */
function htmlArgValues(src){
  const out = [];
  const re = /\bhtml:\s*/g;
  let m;
  while((m = re.exec(src))){
    const start = m.index + m[0].length;
    let depth = 0, i = start, quote = null;
    for(; i < src.length; i++){
      const c = src[i];
      if(quote){ if(c === quote && src[i - 1] !== "\\") quote = null; continue; }
      if(QUOTES.includes(c)){ quote = c; continue; }
      if(c === "(" || c === "[" || c === "{") depth++;
      else if(c === ")" || c === "]" || c === "}"){ if(depth === 0) break; depth--; }
      else if(c === "," && depth === 0) break;
      else if(c === "\n" && depth === 0) break;
    }
    const raw = src.slice(start, i).trim();
    if(raw) out.push({line: src.slice(0, m.index).split("\n").length, raw});
  }
  return out;
}

test("html: 不得拼接未列入白名单的值", () => {
  const bad = [];
  const used = new Set();
  for(const f of jsFiles()){
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    for(const it of htmlArgValues(src)){
      const key = rel + ":" + it.line;
      if(EXEMPT[key]){ used.add(key); continue; }
      const r = riskyParts(it.raw);
      if(r.length) bad.push(key + "  " + r.join(" | ").slice(0, 120));
    }
  }
  for(const k of used) usedExempt.add(k);  assert.equal(bad.length, 0,
    "以下 html: 拼了未列入白名单的值。确认安全请改用 text: 子节点，"
    + "或把来源写进 SAFE_FN / EXEMPT（并写清理由）：\n  " + bad.join("\n  "));
});

test("innerHTML 直接赋值只许字面量或白名单函数", () => {
  const bad = [];
  const used = new Set();
  for(const f of jsFiles()){
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    const re = /\.innerHTML\s*=\s*([^;\n]+)/g;
    let m;
    while((m = re.exec(src))){
      const key = rel + ":" + src.slice(0, m.index).split("\n").length;
      const raw = m[1].trim();
      if(/^["']{2}$/.test(raw)) continue;          // 清空型 innerHTML = ""
      if(EXEMPT[key]){ used.add(key); continue; }
      if(SAFE_FN.test(raw)) continue;
      const r = riskyParts(raw);
      if(r.length) bad.push(key + "  " + r.join(" | ").slice(0, 120));
    }
  }
  assert.equal(bad.length, 0,
    "以下 innerHTML 赋值拼了未列入白名单的值：\n  " + bad.join("\n  "));
  for(const k of used) usedExempt.add(k);
});

test("豁免表不许有僵尸条目（源码挪了位置就要重新评估）", () => {
  const stale = Object.keys(EXEMPT).filter(k => !usedExempt.has(k));
  assert.equal(stale.length, 0,
    "EXEMPT 里这些条目已失效（行号变了或 sink 已删），请重新评估后删除或更新：\n  " + stale.join("\n  "));
});

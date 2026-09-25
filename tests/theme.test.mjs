/* tests/theme.test.mjs —— 照片自定义主题的纯函数护栏（node --test，零依赖）
   为什么只测这些：色彩派生是"用户配出看不见的字"的唯一防线，而它整条链（derive / ensure /
   对比度口径）都是纯函数 —— 用断言锁住最便宜，也最不容易被后面的改动悄悄破坏。
   取色那一步（analyze）要 canvas，交给 tools/test-smoke.mjs 的截图与 tools/gen-test-photos.html
   的客观统计；这里额外守一件事：测试夹具的阈值常数不能和算法漂开。

   载入方式：项目是无构建的原生脚本（IIFE + window.WB），没有模块导出可 require，
   所以用 vm 造一个最小沙箱，先真跑 js/01-utils.js（要它真的 clamp / hexToRgba，
   不能拿测试替身糊过去），再跑 js/07b-custom-theme.js，最后从沙箱里取 WB.customTheme。
   store 换成内存实现 —— 记录层不是这里的被测对象。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

function load(){
  const mem = new Map();
  const win = { WB: {
    store: { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); } },
    bus: { emit(){}, on(){} },
  } };
  const sandbox = { window: win, console, setTimeout, clearTimeout, URL };
  vm.createContext(sandbox);
  for(const f of ["js/01-utils.js", "js/07b-custom-theme.js"]){
    vm.runInContext(read(f), sandbox, {filename: f});
  }
  return win.WB;
}
const WB = load();
const CT = WB.customTheme;

/* ── 对比度：**故意在测试里另写一份** WCAG 公式 ──
   直接复用源码里的 ratio() 会变成自我印证：ratio 本身算错时，派生出的颜色与断言会一起错，
   测试照样绿。这里按 WCAG 2.x 相对亮度独立实现，源码那份如果漂了就会被这组断言抓住 */
const toRgb = hex => {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
const lum = rgba => .2126 * lin(rgba[0]) + .7152 * lin(rgba[1]) + .0722 * lin(rgba[2]);
/* a / b 可以是 hex 字符串，也可以是 over() 给的 [r,g,b] */
const asRgb = c => Array.isArray(c) ? c : toRgb(c);
const ratio = (a, b) => {
  const x = lum(asRgb(a)), y = lum(asRgb(b));
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
/* vm 沙箱里的数组与这里的数组不是同一个 realm，deepStrictEqual 会因为 Array.prototype 不同而报错
   （两边内容一模一样也照样失败）—— 比较前一律 json 化 */
const json = v => JSON.stringify(Array.from(v));
/* rgba(r,g,b,a) → 叠在底色上的合成实色（口径与 07b 的 mix(card, accent, softA) 一致：
   线性插值 t 与 alpha=t 等价，所以半透明底必须先合成再比对比度 —— 踩坑 #086）。
   **必须同样取整到 0-255**：源码的 mix() 是整数通道插值再 r2h(round)，不取整的话两边
   在边界上会差 ~0.007（实测 4.5003 对 4.4937），那是测试自己的假失败 */
const over = (rgbaStr, bgHex) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(rgbaStr);
  assert.ok(m, "颜色不是 rgba() 写法：" + rgbaStr);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const bg = toRgb(bgHex);
  return [0, 1, 2].map(i => Math.round(Number(m[1 + i]) * a + bg[i] * (1 - a)));
};

test("VARS 清单与 derive() 产出的 token 完全对齐（漏一个就会盖住内置主题）", () => {
  const {vars} = CT.derive("light", "#7fa3bd");
  assert.equal(CT.VARS.length, 19);
  assert.equal(json(Object.keys(vars).sort()), json(CT.VARS.slice().sort()));
});

test("derived 配色达标：正文 7:1 / 次要 4.6 / 弱化 3.3 / 强调 3:1", () => {
  /* 夹具选极端值：纯黑、纯白、纯灰、高饱和原色，以及"强调色就是底色本身"
     （用户把强调色挑成看不见的那种）—— 这条正是 ensure() 存在的理由 */
  const accents = ["#7fa3bd", "#dd9a84", "#8fa6d8", "#000000", "#ffffff", "#7f7f7f",
    "#ff0000", "#00ff00", "#0000ff", "#f6f1e7", "#24282e"];
  for(const base of ["light", "dark"]){
    for(const accent of accents){
      const {vars} = CT.derive(base, accent);
      const where = base + "/" + accent;
      assert.ok(ratio(vars["--ink"], vars["--bg"]) >= 7, "ink 未达 7:1 " + where);
      assert.ok(ratio(vars["--ink-2"], vars["--bg"]) >= 4.6, "ink-2 未达 4.6:1 " + where);
      assert.ok(ratio(vars["--ink-3"], vars["--bg"]) >= 3.3, "ink-3 未达 3.3:1 " + where);
      assert.ok(ratio(vars["--accent"], vars["--bg"]) >= 3, "accent 未达 3:1 " + where);
      assert.ok(ratio(vars["--accent-2"], vars["--bg"]) >= 3, "accent-2 未达 3:1 " + where);
      /* accent-ink 是「淡底上的文字」：底 = accent-soft 叠在 card 上（不是强调色实色） */
      assert.ok(ratio(vars["--accent-ink"], over(vars["--accent-soft"], vars["--card"])) >= 4.5,
        "accent-ink 未达 4.5:1 " + where);
    }
  }
});

test("derive() 兜底：强调色缺失 / 非法也不抛错，且档位与 seed 形状稳定", () => {
  for(const bad of [null, undefined, "", "not-a-color"]){
    const d = CT.derive("light", bad);
    assert.ok(d.vars["--bg"] && d.vars["--accent"], "兜底没产出颜色：" + String(bad));
    assert.equal(json(Object.keys(d.seed).sort()), json(["accent", "accent2", "bg", "card", "ink", "ink3"]));
  }
  /* 深色档必须比浅色档暗，否则档位判断写反了 */
  assert.ok(lum(toRgb(CT.derive("dark", "#7fa3bd").vars["--bg"])) <
    lum(toRgb(CT.derive("light", "#7fa3bd").vars["--bg"])));
});

test("id 解析：bare 只剥一层前缀，找不到的记录一律 null（降级靠它）", () => {
  assert.equal(CT.bare("custom:ct_abc"), "ct_abc");
  assert.equal(CT.bare("ct_abc"), "ct_abc");
  assert.equal(CT.bare(null), "");
  assert.equal(CT.resolve("custom:ct_不存在"), null);
  const rec = {id: "ct_x", name: "夜里的窗", base: "dark", vars: {"--bg": "#24282e"}};
  WB.store.set(CT.KEY, [rec]);
  const meta = CT.resolve("custom:" + rec.id);
  assert.equal(meta.custom, true);
  assert.equal(meta.own, false);
  assert.equal(meta.dark, true);
  assert.equal(meta.id, "custom:ct_x");
  assert.equal(CT.resolve("custom:ct_x").cn, "夜里的窗");
});

test("取色阈值：算法与测试图生成器用同一组常数（夹具不能漂）", () => {
  const alg = /if\(l > (\.\d+) \|\| l < (\.\d+) \|\| sat < (\.\d+)\) continue;/.exec(read("js/07b-custom-theme.js"));
  const baseLine = /lumAvg < (\.\d+) \? "dark"/.exec(read("js/07b-custom-theme.js"));
  const fix = /F_LUM_HI = (\.\d+), F_LUM_LO = (\.\d+), F_SAT = (\.\d+), BASE_LINE = (\.\d+)/
    .exec(read("tools/gen-test-photos.html"));
  assert.ok(alg && baseLine, "analyze() 里的阈值写法变了：请同步本测试与 tools/gen-test-photos.html");
  assert.ok(fix, "gen-test-photos.html 里的 F_LUM_* / F_SAT / BASE_LINE 写法变了");
  assert.deepEqual([alg[1], alg[2], alg[3], baseLine[1]], [fix[1], fix[2], fix[3], fix[4]]);
});

test("首帧档位表：与 THEMES 表对数、注入幂等、缺标记即报错", () => {
  const tb = require(path.join(ROOT, "tools/theme-base.js"));
  const {map, count} = tb.readThemeBase();
  assert.equal(count, 9, "THEMES 解析数变了：要么真加了主题，要么字段写法改了导致静默漏项");
  assert.equal(map.light, "light");
  assert.equal(map.rose, "rose");   // own=true：档位就是它自己
  assert.equal(map.ink, "dark");    // own=false：用声明的 base
  assert.equal(map.hc, "light");
  const html = read("index.html");
  const once = tb.injectThemeBase(html);
  assert.equal(tb.injectThemeBase(once), once, "重复注入应当没有变化");
  assert.throws(() => tb.injectThemeBase("<html></html>"), /找不到首帧档位表的标记/);

  /* index.html 里那份是构建期注入的：改了 THEMES 却没跑 node build.js，就靠这一条挡下
     （冒烟脚本也查这条，但它要 Chrome；`npm test` 应当零外部依赖就能查） */
  const m = /var BASE = \/\*__WB_THEME_BASE__\*\/\{([^}]*)\}/.exec(html);
  assert.ok(m, "index.html 里找不到首帧档位表的标记");
  const got = JSON.parse("{" + m[1] + "}");
  const norm = o => Object.keys(o).sort().map(k => k + "=" + o[k]).join(",");
  assert.equal(norm(got), norm(map), "index.html 的首帧档位表过期了 → 跑一次 node build.js");
});

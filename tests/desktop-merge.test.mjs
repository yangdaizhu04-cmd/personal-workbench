/* tests/desktop-merge.test.mjs —— 桌面桥「补账」那一段的纯逻辑护栏（node --test，零依赖）
   护的是踩坑 #091 的修法本身：Rust 在窗口隐藏期间发过的提醒 id，要按**清单里的形状**分别落到
   两个前端记账键上 —— 待办（`todo:<id>:<日期>`）剥成 `firedReminders:<日期>` 里的一项，
   其余（晨间/收工/倒数日）原样落 `firedDesktop:<业务日>`。串了键或串了形状，
   症状还是"同一条提醒响两次"，但只有在真机上跨"隐藏→可见"才看得见 —— 所以在这里钉住。

   载入方式与 theme.test.mjs 同一套路：vm 沙箱真跑 js/18-desktop.js（不复制它的逻辑，
   否则测试就成了抄一遍实现）。差别是这里要给 Tauri 入口与 store 打桩，
   并把 setTimeout / setInterval 换成空实现：文件尾部那段"启动后 2.5 秒推一次"的接线
   在测试里不需要跑，跑了反而要靠更多桩。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = "2026-09-25";
const BIZ = "2026-09-24";   // 故意与 TODAY 不同：业务日（凌晨 4 点为界）与自然日不是一回事
/* vm 沙箱里的数组与这里的数组不是同一个 realm，deepStrictEqual 会因为 Array.prototype
   不同而失败（内容一模一样也报错）→ 一律 json 化再比 */
const json = v => JSON.stringify(Array.from(v));

function load(firedList, {reject = false} = {}){
  const mem = new Map();
  const calls = [];
  const warns = [];   // 拦下 console.warn：失败路径该说的话进数组被断言，而不是刷在测试输出里
  const WB = {
    store: { get: (k, d) => (mem.has(k) ? mem.get(k) : d), set: (k, v) => { mem.set(k, v); } },
    bus: { emit(){}, on(){} },
    theme: { all: () => ({}) },
    ui: { toast(){} },
    bizDate: () => BIZ,
    REMIND_AHEAD: {"0": 0, "5": 5},
    TODO_WINDOW_MIN: 30,
  };
  const win = {
    WB,
    __TAURI_INTERNALS__: {
      invoke(cmd){
        calls.push(cmd);
        return reject ? Promise.reject(new Error("通道没接上")) : Promise.resolve(firedList);
      },
    },
  };
  const sandbox = {
    window: win,
    document: { addEventListener(){}, visibilityState: "visible" },
    console: { log: console.log, error: console.error, warn: (...a) => warns.push(a.join(" ")) },
    setTimeout: () => 0,      // 尾部的接线不跑（见文件头注释）
    setInterval: () => 0,
    clearTimeout(){ },
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/18-desktop.js"), "utf8"), sandbox,
    {filename: "18-desktop.js"});
  return {desktop: win.WB.desktop, mem, calls, warns};
}

test("补账：待办剥成 id 落 firedReminders，其余原样落 firedDesktop", async () => {
  const {desktop, mem, calls} = load([
    "todo:t_a:" + TODAY,          // 清单里的形状：todo:<id>:<t.date>
    "todo:t_b:" + TODAY,
    "morning:" + TODAY,           // 其余：晨间 / 收工 / 倒数日
    "offwork:" + TODAY,
    "cd:c1:" + TODAY,
  ]);
  const added = await desktop.mergeFired();
  assert.equal(json(calls), json(["fired_ids"]));
  assert.equal(added, 5);
  assert.equal(json(mem.get("firedReminders:" + TODAY)), json(["t_a", "t_b"]));
  assert.equal(json(mem.get("firedDesktop:" + BIZ)),
    json(["morning:" + TODAY, "offwork:" + TODAY, "cd:c1:" + TODAY]));
});

test("补账：幂等（第二次不重复记、也不重复写 store）", async () => {
  const {desktop, mem} = load(["todo:t_a:" + TODAY, "morning:" + TODAY]);
  assert.equal(await desktop.mergeFired(), 2);
  const before = json([...mem.entries()].map(([k, v]) => k + "=" + JSON.stringify(v)));
  assert.equal(await desktop.mergeFired(), 0, "第二次不该再有新增");
  assert.equal(json([...mem.entries()].map(([k, v]) => k + "=" + JSON.stringify(v))), before,
    "没有新增就不该写 store");
});

test("补账：与前端已有的记账**合并**而不是覆盖", async () => {
  const {desktop, mem} = load(["todo:t_new:" + TODAY]);
  mem.set("firedReminders:" + TODAY, ["t_old"]);
  mem.set("firedDesktop:" + BIZ, ["offwork:" + TODAY]);
  await desktop.mergeFired();
  assert.equal(json(mem.get("firedReminders:" + TODAY)), json(["t_old", "t_new"]));
  assert.equal(json(mem.get("firedDesktop:" + BIZ)), json(["offwork:" + TODAY]),
    "没有新 id 就不该动这个键");
});

test("拿不到清单时照旧放行：返回 0、留一句 warning、firedPending 归位", async () => {
  const {desktop, warns, mem} = load([], {reject: true});
  assert.equal(await desktop.mergeFired(), 0);
  assert.equal(desktop.firedPending(), false, "失败后也必须解除让位门，否则提醒会被永久挡住");
  assert.equal(mem.size, 0, "失败不该写坏任何记账键");
  assert.equal(warns.length, 1, "失败要留痕（打包后 console 也看得到）");
  assert.match(warns[0], /已发提醒清单读取失败/);
});

test("firedPending：补账在飞的时候为真（main.js 的让位门靠它）", async () => {
  const {desktop} = load([]);
  assert.equal(desktop.firedPending(), false);
  const flying = desktop.mergeFired();
  assert.equal(desktop.firedPending(), true, "请求发出后、回来之前必须为真");
  await flying;
  assert.equal(desktop.firedPending(), false);
});

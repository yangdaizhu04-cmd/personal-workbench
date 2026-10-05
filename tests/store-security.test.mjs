/* tests/store-security.test.mjs —— 数据层安全与覆盖语义的护栏（node --test，零依赖） */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = v => JSON.stringify(v);

function load(){
  const mem = new Map();
  const ls = {
    get length(){ return mem.size; },
    key: i => Array.from(mem.keys())[i] ?? null,
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
  };
  const sandbox = {
    window: {},
    localStorage: ls,
    document: { createElement: () => ({ style: {} }) },
    addEventListener(){}, setTimeout: () => 0, setInterval: () => 0, clearTimeout(){},
    Promise, console: { log(){}, error(){}, warn(){} },
  };
  sandbox.window.localStorage = ls;
  vm.createContext(sandbox);
  for(const f of ["js/01-utils.js", "js/02-store.js"]){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, {filename: f});
  }
  return {WB: sandbox.window.WB, store: sandbox.window.WB.store, mem};
}

test("导出：不含 webdav / byok / token 三处明文凭据", () => {
  const {store} = load();
  store.set("webdav", {url: "https://dav.example/", user: "u", pass: "pw", auto: true});
  store.set("byok", {aiKey: "sk-abcdef0123456789"});
  store.set("token", "sess-token-abc");
  store.set("todos", [{id: "t1", title: "买菜"}]);
  store.set("webdavLastHash", "12345");
  store.flush();

  const out = store.exportAll();
  assert.equal(out.webdav, undefined, "webdav 里有明文密码，不能进备份");
  assert.equal(out.byok, undefined, "byok 里有 AI Key，不能进备份");
  assert.equal(out.token, undefined, "云端会话 token 不能进备份");
  assert.equal(json(out.todos), json([{id: "t1", title: "买菜"}]), "普通数据必须照常导出");
  assert.equal(out.webdavLastHash, "12345", "指纹键不是机密，不该被误删");
});

test("导入：外部文件里的凭据类键一律拒收（配置分享的数据外传链）", () => {
  const {store} = load();
  store.set("webdav", {url: "https://mine.example/", user: "me", pass: "mine"});
  store.flush();
  store.importAll({theme: "dark",
    webdav: {url: "https://evil.example/dav/", user: "x", pass: "y", auto: true},
    byok: {aiKey: "sk-stolen"}}, {merge: true});
  assert.equal(store.get("webdav").url, "https://mine.example/", "WebDAV 指向不许被外部文件改写");
  assert.equal(store.get("byok"), undefined, "AI Key 不许从外部文件写入");
  assert.equal(store.get("theme"), "dark", "普通配置照常导入");
});

test("导入：敏感键只在显式 allowSecrets 时才写进去", () => {
  const {store} = load();
  store.importAll({webdav: {url: "https://ok.example/"}}, {merge: true}, {allowSecrets: true});
  assert.equal(store.get("webdav").url, "https://ok.example/");
});

test("覆盖导入：文件里没有的键要被真删掉（旧实现只写不删）", () => {
  const {store, mem} = load();
  store.set("todos", [{id: "t1"}]);
  store.set("wishes", [{id: "w1"}]);
  store.set("interrupts", [{id: "i1"}]);
  store.flush();
  store.importAll({todos: [{id: "t2"}]}, {merge: false});
  assert.equal(json(store.get("todos")), json([{id: "t2"}]));
  assert.equal(store.get("wishes"), undefined, "备份里没有的键必须删掉");
  assert.equal(store.get("interrupts"), undefined);
  assert.equal(mem.has("wb:interrupts"), false, "底层也要真的删了");
});

test("覆盖导入：凭据类键不参与删除（不该顺手把用户的 Key 清空）", () => {
  const {store} = load();
  store.set("byok", {aiKey: "sk-keepme"});
  store.set("wishes", [{id: "w1"}]);
  store.flush();
  store.importAll({todos: [{id: "t1"}]}, {merge: false});
  assert.equal(store.get("byok").aiKey, "sk-keepme", "恢复备份不该清掉 BYOK Key");
  assert.equal(store.get("wishes"), undefined);
});

test("合并导入：无 id 的记录不再被静默丢弃", () => {
  const {store} = load();
  store.set("notes", [{id: "n1", content: "有 id 的"}, {content: "本地就有一条无 id 的"}]);
  store.flush();
  store.importAll({notes: [{content: "备份里的无 id 记录"}]}, {merge: true});
  const got = store.get("notes");
  assert.equal(got.length, 3, "备份里无 id 的那条必须进来（原来被当成已存在而丢弃）");
  assert.ok(got.some(n => n.content === "备份里的无 id 记录"));
  assert.equal(got.filter(n => n.id === "n1").length, 1, "有 id 的按 id 去重，仍只留一条");
});

test("金额口径：字符串金额既不拼接也不 NaN 也不抛", () => {
  const {WB} = load();
  const a = WB.amount;
  assert.equal(a(12.5), 12.5);
  assert.equal(a("12.5"), 12.5, "字符串数字要能吃进去");
  assert.equal(a(""), 0);
  assert.equal(a(null), 0);
  assert.equal(a(undefined), 0);
  assert.equal(a(NaN), 0);
  assert.equal(a(Infinity), 0);
  assert.equal(a("abc"), 0);
  assert.equal(a(" 3 "), 3);
  /* 真正会炸的那条路径：字符串金额 + reduce + toFixed */
  const rows = [{amount: "12.5"}, {amount: 7}];
  const spend = rows.reduce((s, l) => s + a(l.amount), 0);
  assert.equal(spend, 19.5, "reduce 不得变成字符串拼接");
  assert.equal(spend.toFixed(0), "20", "toFixed 不得抛 TypeError");
  assert.equal(Math.round(spend * 100) / 100, 19.5, "不得出现 NaN");
});

test("toInt / num：合法的 0 不被当成「没填」", () => {
  const {WB} = load();
  assert.equal(WB.toInt("0", 25), 0, "填 0 是「我想要 0」，不是「没填」");
  assert.equal(WB.toInt("", 25), 25);
  assert.equal(WB.toInt("abc", 25), 25);
  assert.equal(WB.toInt("7.9", 25), 7);
  assert.equal(WB.num("0", .8), 0, "音量调到 0 不该被顶回 0.8");
  assert.equal(WB.num(undefined, .8), .8);
});

test("safeUrl：伪协议一律拦下，正常地址放行", () => {
  const {WB} = load();
  assert.equal(WB.safeUrl("https://a.com/x"), "https://a.com/x");
  assert.equal(WB.safeUrl("http://a.com"), "http://a.com");
  assert.equal(WB.safeUrl("mailto:a@b.com"), "mailto:a@b.com");
  assert.equal(WB.safeUrl("#anchor"), "#anchor");
  assert.equal(WB.safeUrl("/todos"), "/todos");
  assert.equal(WB.safeUrl("javascript:alert(1)"), "", "javascript: 必须拦下");
  assert.equal(WB.safeUrl("JaVaScRiPt:alert(1)"), "", "大小写变体也要拦");
  assert.equal(WB.safeUrl("data:text/html,<script>x</script>"), "", "data: 要拦");
  assert.equal(WB.safeUrl("vbscript:msgbox"), "", "vbscript: 要拦");
  assert.equal(WB.safeUrl("java\tscript:alert(1)"), "", "夹控制字符的伪协议也要拦");
  assert.equal(WB.safeUrl("  javascript:alert(1)"), "", "前导空白也要拦");
  assert.equal(WB.safeUrl(""), "");
  assert.equal(WB.safeUrl(null), "");
});

test("safeColor：只放行 #hex，其它一律回落默认色", () => {
  const {WB} = load();
  assert.equal(WB.safeColor("#fff"), "#fff");
  assert.equal(WB.safeColor("#7FA3BD"), "#7FA3BD");
  assert.equal(WB.safeColor("#7fa3bdcc"), "#7fa3bdcc");
  assert.equal(WB.safeColor("red", "var(--accent)"), "var(--accent)", "关键字不放行");
  assert.equal(WB.safeColor("' onerror='alert(1)", "var(--accent)"), "var(--accent)",
    "闭合引号逃逸必须被挡");
  assert.equal(WB.safeColor(null, "#000"), "#000");
});

test("csvCell：以公式字符开头的字段加前缀（加引号挡不住）", () => {
  const {WB} = load();
  assert.equal(WB.csvCell("买菜"), '"买菜"');
  assert.equal(WB.csvCell('a"b'), '"a""b"');
  assert.equal(WB.csvCell("=1+1"), '"\'=1+1"');
  assert.equal(WB.csvCell("-cmd"), '"\'-cmd"');
  assert.equal(WB.csvCell("@SUM(A1)"), '"\'@SUM(A1)"');
  assert.equal(WB.csvCell("+1"), '"\'+1"');
  assert.equal(WB.csvCell(12.5), '"12.5"');
  assert.equal(WB.csvCell(null), '""');
});

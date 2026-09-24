/* tools/theme-base.js —— 首帧档位表的唯一生成处
   为什么需要它：index.html 的首帧内联脚本必须跑在样式表之前，那时还没有 WB.theme，
   共享不了运行时代码。于是让"主题表"只有一个来源（js/07-theme.js 的 THEMES），
   首帧那份映射由构建期注入（build.js 调用），并由冒烟脚本做一致性守卫。
   用法（CommonJS）：
     const {readThemeBase, injectThemeBase} = require("./tools/theme-base.js");
     html = injectThemeBase(html);            // 注入到标记处
     const {map, count} = readThemeBase();    // 只读，用于一致性校验
   ESM 侧用 default 导入：import themeBase from "./theme-base.js"; */
const fs = require("fs");
const path = require("path");

const THEME_SRC = path.resolve(__dirname, "../js/07-theme.js");
const MARKER = "/*__WB_THEME_BASE__*/";

/* 从 js/07-theme.js 的 THEMES 表里读 id → 档位映射。
   刻意用逐条正则而不是 eval：构建脚本不执行被解析的源码，规则简单且不会因为源码里
   多一行注释就解析错（THEMES 的字段顺序是固定写法：id, cn, base, own, dark, color） */
function readThemeBase(){
  const src = fs.readFileSync(THEME_SRC, "utf8");
  const block = /const THEMES = \[([\s\S]*?)\n\];/.exec(src);
  if(!block) throw new Error("theme-base: 在 js/07-theme.js 里找不到 THEMES 表");
  const re = /\{\s*id:\s*"([^"]+)"\s*,\s*cn:\s*"[^"]*"\s*,\s*base:\s*"([^"]+)"\s*,\s*own:\s*(true|false)\s*,\s*dark:\s*(true|false)\s*,\s*color:\s*"[^"]+"/g;
  const map = {};
  let m;
  while((m = re.exec(block[1]))){
    /* own=true 的主题色块直接挂在 data-theme 上，所以档位就是它自己 */
    map[m[1]] = m[3] === "true" ? m[1] : m[2];
  }
  const count = Object.keys(map).length;
  if(count < 3) throw new Error("theme-base: THEMES 只解析到 " + count + " 项，格式可能改了");
  return {map, count};
}

/* 把映射注入 HTML 的标记处；标记缺失直接报错（静默不注入 = 首帧闪一下，最难查） */
function injectThemeBase(html){
  const {map} = readThemeBase();
  const json = JSON.stringify(map);
  const re = new RegExp("var BASE = \\/\\*__WB_THEME_BASE__\\*\\/\\{[^}]*\\};");
  if(!re.test(html)) throw new Error("theme-base: index.html 里找不到首帧档位表的标记 " + MARKER);
  return html.replace(re, "var BASE = " + MARKER + json + ";");
}

module.exports = {readThemeBase, injectThemeBase, MARKER};

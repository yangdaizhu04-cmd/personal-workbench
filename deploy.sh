#!/usr/bin/env bash
# ============================================================
# 个人工作台 · 云端一键部署脚本（CloudBase / 腾讯云开发）
# 前置：Node ≥ 18；已 npm i -g @cloudbase/cli；已 tcb login
# 用法：ENV_ID=your-env-id WB_GATE_SALT=<长随机串> bash deploy.sh
#
# WB_GATE_SALT 是 2026-10-05 安全整改后新增的必填项（踩坑 #097）：
# 三个云函数都靠它派生 uid 与签发会话，**缺省会直接 throw 拒绝启动** ——
# 这是故意的，不要在代码里加编译期常量兜底（那个常量在公开仓库里，等于没有盐）。
# 没传就在本地生成一个并提示你稍后去控制台固定下来：
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ============================================================
set -e
ENV_ID="${ENV_ID:?请先设置环境变量 ENV_ID（云开发环境 ID）}"
cd "$(dirname "$0")"

if [ -z "$WB_GATE_SALT" ]; then
  WB_GATE_SALT="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  echo "⚠ 未提供 WB_GATE_SALT，本地临时生成一个：$WB_GATE_SALT"
  echo "  请在 CloudBase 控制台给 gate / sync / proxy 各配置同名环境变量，值就用这串（否则换实例后会话失效）"
fi

echo "▶ 1/5 注入环境 ID 到前端配置…"
node -e "
const fs = require('fs');
const p = 'js/00-env.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/cloudBaseUrl:\s*\"[^\"]*\"/, 'cloudBaseUrl: \"https://' + process.env.ENV_ID + '.service.tcloudbase.com\"');
fs.writeFileSync(p, s);
console.log('   js/00-env.js 已写入 https://' + process.env.ENV_ID + '.service.tcloudbase.com');
"

echo "▶ 2/5 配置云函数环境变量 WB_GATE_SALT…"
for fn in gate sync proxy; do
  tcb fn config update "$fn" -e "$ENV_ID" --env "WB_GATE_SALT=$WB_GATE_SALT" \
    || echo "   ⚠ $fn 的环境变量设置失败（CLI 版本差异）—— 请到控制台手动配置，否则该函数会启动即报错"
done

echo "▶ 3/5 部署云函数 gate / sync / proxy（HTTP 访问已开）…"
tcb fn deploy gate  -e "$ENV_ID" --force --path cloud/functions/gate  --install-dependency -r 2>/dev/null || tcb fn deploy gate  -e "$ENV_ID" --force --dir cloud/functions/gate
tcb fn deploy sync  -e "$ENV_ID" --force --path cloud/functions/sync  --install-dependency 2>/dev/null || tcb fn deploy sync  -e "$ENV_ID" --force --dir cloud/functions/sync
tcb fn deploy proxy -e "$ENV_ID" --force --path cloud/functions/proxy --install-dependency 2>/dev/null || tcb fn deploy proxy -e "$ENV_ID" --force --dir cloud/functions/proxy

echo "▶ 4/5 构建单文件版本…"
node build.js --cloud

echo "▶ 5/5 部署静态托管（PWA）…"
tcb hosting deploy cloud/hosting -e "$ENV_ID" --target-path .

echo ""
echo "✅ 部署完成！访问 https://$ENV_ID.service.tcloudbase.com 或控制台默认域名"
echo "   · 首次打开设置访问密码（scrypt 加盐存储，会话 token 30 天有效）"
echo "   · 手机浏览器打开 → 添加到主屏幕 = PWA 安装"
echo "   · 换设备时用同一个密码即可看到同一份数据"

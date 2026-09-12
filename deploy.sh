#!/usr/bin/env bash
# ============================================================
# 个人工作台 · 云端一键部署脚本（CloudBase / 腾讯云开发）
# 前置：Node ≥ 18；已 npm i -g @cloudbase/cli；已 tcb login
# 用法：ENV_ID=your-env-id bash deploy.sh
# ============================================================
set -e
ENV_ID="${ENV_ID:?请先设置环境变量 ENV_ID（云开发环境 ID）}"
cd "$(dirname "$0")"

echo "▶ 1/4 注入环境 ID 到前端配置…"
node -e "
const fs = require('fs');
const p = 'js/00-env.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/cloudBaseUrl:\s*\"[^\"]*\"/, 'cloudBaseUrl: \"https://' + process.env.ENV_ID + '.service.tcloudbase.com\"');
fs.writeFileSync(p, s);
console.log('   js/00-env.js 已写入 https://' + process.env.ENV_ID + '.service.tcloudbase.com');
"

echo "▶ 2/4 部署云函数 gate / sync / proxy（HTTP 访问已开）…"
tcb fn deploy gate  -e "$ENV_ID" --force --path cloud/functions/gate  --install-dependency -r 2>/dev/null || tcb fn deploy gate  -e "$ENV_ID" --force --dir cloud/functions/gate
tcb fn deploy sync  -e "$ENV_ID" --force --path cloud/functions/sync  --install-dependency 2>/dev/null || tcb fn deploy sync  -e "$ENV_ID" --force --dir cloud/functions/sync
tcb fn deploy proxy -e "$ENV_ID" --force --path cloud/functions/proxy --install-dependency 2>/dev/null || tcb fn deploy proxy -e "$ENV_ID" --force --dir cloud/functions/proxy

echo "▶ 3/4 构建单文件版本…"
node build.js --cloud

echo "▶ 4/4 部署静态托管（PWA）…"
tcb hosting deploy cloud/hosting -e "$ENV_ID" --target-path .

echo ""
echo "✅ 部署完成！访问 https://$ENV_ID.service.tcloudbase.com 或控制台默认域名"
echo "   · 首次打开设置访问密码（服务端校验）"
echo "   · 手机浏览器打开 → 添加到主屏幕 = PWA 安装"

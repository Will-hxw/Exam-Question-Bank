# Cloudflare Worker — DeepSeek API 代理

防止 API Key 暴露在前端。

## 部署

1. 编辑 `worker.js`，把 `API_KEY` 改成你的真实 Key
2. 编辑 `worker.js`，把 `ALLOWED_ORIGINS` 改成你的网站域名
3. `worker.js` 里 `TARGET` 按需修改（默认 `https://api.deepseek.com`）

```bash
npm install -g wrangler   # 首次安装
wrangler login            # 登录 Cloudflare
wrangler deploy           # 部署
```

4. 部署成功后会得到一个 URL：`https://cquccp-api-proxy.你的用户名.workers.dev`
5. 编辑 `ai.js`，把 `_CF_WORKER` 改成这个 URL
6. `python build.py` 重新构建部署

## 工作原理

```
浏览器 → Cloudflare Worker → DeepSeek API
         (有 Key)           (验证 Key)
```

前端不传 Key，Worker 用自己的 Key 转发请求。

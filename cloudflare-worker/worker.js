// Cloudflare Worker — DeepSeek API 反向代理
// 部署: npx wrangler deploy
// 配置: 复制 config.example.json 为 config.json 并填入真实 Key

import config from './config.json';

const TARGET = 'https://api.deepseek.com';
const API_KEY = config.deepseekApiKey;

function getAllowedOrigin(request) {
  return request.headers.get('Origin') || '*';
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = getAllowedOrigin(request);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 仅允许 POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Access-Control-Allow-Origin': origin }
      });
    }

    // 构建转发请求（使用服务端硬编码的 Key，不信任客户端传来的）
    const targetUrl = TARGET + url.pathname;
    let body;
    try {
      body = await request.text();
    } catch (e) {
      return new Response('Bad Request: unable to read body', {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': origin }
      });
    }

    const proxyRequest = new Request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: body
    });

    // 转发并流式返回
    try {
      const response = await fetch(proxyRequest);

      const upstreamType = response.headers.get('Content-Type');
      const outHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-cache'
      };
      if (upstreamType) {
        outHeaders['Content-Type'] = upstreamType;
      }
      // 仅当上游成功且有 body 时按流式返回；否则回传状态码即可
      if (!response.ok || !response.body) {
        const errText = response.body ? await response.text() : 'Upstream error';
        return new Response(errText, {
          status: response.status,
          headers: outHeaders
        });
      }

      return new Response(response.body, {
        status: response.status,
        headers: Object.assign(outHeaders, {
          'Content-Type': upstreamType || 'text/event-stream'
        })
      });
    } catch (err) {
      return new Response('Proxy Error: ' + err.message, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': origin }
      });
    }
  }
};

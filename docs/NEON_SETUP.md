# Neon 开发环境实录

## 项目和工具

- 通过 npm 安装 Neon CLI 9.9.3。PowerShell 将未加引号的逗号服务参数拆开后，改用两次 `--services`，分别传入 `postgres` 和 `auth`。
- `neon init` 生成 Git 忽略的 `.neon` 和仓库内的 `neon.ts`，并安装 `@neon/config` / `@neon/env`。初次离线链接随后通过 CLI 登录核对。新加坡 Free 项目为 `cqu-exam-question-bank-dev`，PostgreSQL 16，默认 Neon 分支名 `production`。这个项目用于开发预览。
- CLI 已安装 Codex、Cursor、Kimi Code、VS Code 的 Neon 插件，并为检测到的 Antigravity、Factory Droid、Gemini CLI、GitHub Copilot、Junie、Kiro、OpenCode、Pi、Windsurf 添加用户级技能和 MCP 配置。Claude Code 和 Claude Desktop 的插件安装失败。重新核对时，Codex 用户配置中的 Neon 插件已启用，其内置 MCP 指向 `mcp.neon.tech`，七项 Neon 技能均为 up to date。
- 已直接下载 [Neon 官方技能](https://neon.com/.well-known/agent-skills/neon/SKILL.md)，与安装文件的 SHA-256 一致。项目沿用插件自带 MCP，保持无重复项目级登记。当前聊天的工具清单仍未出现 Neon MCP，本轮远端实测通过 CLI 与运行中的应用完成。

## 已执行的联调

```
neon config plan → No changes — branch production already matches the policy.
neon deploy      → Utilized services: Postgres, Neon Auth
                   Pulled 7 Neon variables into .env.local
npm run build    → Compiled successfully
GET /api/health  → 200, ok: true
GET /bank/manifest.json + first shard → 200, SHA-256 matches, same 41-question release in Neon
GET /api/public/questions?q=党章      → 200, 12 results, option rationales present
GET /                            → 307 /login for an anonymous visitor
Neon Auth JWKS                   → 200
POST /api/auth/sign-in/email     → 401 INVALID_EMAIL_OR_PASSWORD for an unknown account
```

Node 验证使用 Neon HTTP 驱动与真实新加坡 PostgreSQL。迁移和内容同步使用直连 URL，前端和服务器从 Git 忽略的 `.env.local` 加载各自配置。新增仅供本地应用的 Cookie 签名密钥、内容失效密钥和本地站点 URL，配置值没有写入 Git。

已开启邮箱 OTP、注册时必须验证且发送验证码、验证后自动登录、改密后撤销会话。现阶段确认真实分支接入和错误路径，注册、实际收码并登录、已验证会话的云端写入和自定义 QQ 投递仍需实际验收。

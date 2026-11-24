# Neon 开发环境实录

这里按时间记录预览联调。现行开发、预览与生产配置见 [部署手册](DEPLOY.md)。

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

后续预览同步仅发布事实和考法均通过的 82 题，共 14 个专题。实际核对 Next 的静态目录与 Neon 的内容摘要、题目数一致。在真实 Neon 事务中生成 50 题并判得 1 分，回滚后验证测试记录已清除。

131 题审阅版本在同一 Neon 开发库完成事务试导入。随后确认 Makers 预览 CDN 清单的摘要一致，再以 `npm run content:sync -- --preview --apply` 提交该版本。实际预览页面的 14 个专题及题量与 Neon 一致。

Node 验证使用 Neon HTTP 驱动与真实新加坡 PostgreSQL。迁移和内容同步使用直连 URL，前端和服务器从 Git 忽略的 `.env.local` 加载各自配置。新增仅供本地应用的 Cookie 签名密钥、内容失效密钥和本地站点 URL，配置值没有写入 Git。

已开启邮箱 OTP、注册验证和改密后撤销会话。早期记录覆盖真实分支接入和错误路径。

后续在 Makers 预览核对了 131 题版本的目录和健康检查。将预览域名加入开发 Auth 的可信域名后，使用评测账号完成了邮箱验证和登录。签名回调联调中，密码重置请求返回 200，中文模板邮件由 QQ 接收，投递记录为 `sent` 且尝试次数为 1。正式站的邮件与业务复测见 [验收证据](ACCEPTANCE.md)。

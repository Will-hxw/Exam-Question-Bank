# Makers 与 Neon 部署

## 预览与生产环境

| 环境 | 入口或构建 | 数据和身份 |
| --- | --- | --- |
| 本机评测 | `http://localhost:3308/`，使用本地生产构建 | 独立 Neon 开发库和开发 Auth |
| Makers 预览 | 在 `cqu-rudang` 项目中选择相应预览部署 | 独立评测库、开发 Auth 和授权测试收件人 |
| 正式站 | [cqu.xiaoweihua.cn](https://cqu.xiaoweihua.cn/)，从 GitHub `main` 自动构建 | 独立 Neon 生产库和生产 Auth |

Makers 项目 `cqu-rudang` 关联 [GitHub 仓库 `Will-hxw/cqu-rudang`](https://github.com/Will-hxw/cqu-rudang)。项目的构建、Node.js 版本和缓存配置以根目录的 `edgeone.json` 为准。正式域继续使用现有的 CNAME 和 TLS 绑定。变更 DNS 时仅操作 `cqu` 子域。

正式库使用 Neon 新加坡项目 `cqu-exam-question-bank-prod`（`raspy-mud-91046199`）。配置环境时对照 [变量示例](../.env.example)，在相应托管环境中设置数据库连接、Auth 地址和 Cookie 密钥、本站 URL 与内容失效密钥。生产站点 URL 和生产 Auth 的可信域名均为 `https://cqu.xiaoweihua.cn`。

生产设置 `REQUIRE_COMPLETE_BANK=1`，保持邮箱验证和改密后撤销会话开启。上线前在测试环境验证，推送后用 GitHub CI 和 Makers 部署记录对照提交。匿名访问正式首页应跳转到登录页，登录页和健康检查应返回 200，题库清单应与本次发布摘要一致。 [验收证据](ACCEPTANCE.md)

## 中文验证码邮件

Neon Auth 生成并校验验证码，签名的 `send.otp` 事件由本站 `/api/webhooks/neon` 接收，再使用 QQ SMTP 渲染并发送中文模板。正式和预览环境各自配置 `NEON_OTP_WEBHOOK_ENABLED`、`NEON_OTP_WEBHOOK_ENDPOINT_ID` 和 `QQ_SMTP_AUTH_CODE`。授权码仅存放在该环境的安全变量中。

发送使用 `1176843521@qq.com`、`smtp.qq.com:465` 和 TLS。更换部署域名时，先将该域名加入对应的 Neon Auth 可信域名，再验证回调和投递。线上收件只用本人或授权邮箱测试。出站故障需要回退时，先停用对应的 Webhook 订阅，再验证 Neon 托管模板投递。 [Neon 邮件定制](https://neon.com/docs/auth/guides/customize-emails) · [Webhook 协议](https://neon.com/docs/auth/guides/webhooks)

早期的 404、131 题预览、Auth 域名校验和投递记录见 [平台早期核查](PLATFORM_CHECK.md)、[Neon 联调实录](NEON_SETUP.md) 和 [验收证据](ACCEPTANCE.md)。

## 新用户反馈与分享邮件

正式站复用 QQ SMTP 和验证码邮件外框逐封发送。Neon 定时触发器按 UTC 每两小时运行，对应北京时间偶数小时的整点。GitHub 的 `Signup follow-up email` 工作流保留为手动入口。Neon 使用专用令牌，手动入口使用本仓库 `main` 的 GitHub OIDC 令牌。

已验证账号累计保存至少 20 次非空作答即符合条件。普通练习和已交模考的实际作答都计入。已有邮件接收回执的账号保持已发送。QQ 明确拒绝登录时至少暂停一小时，明确的暂时投递失败可重试。对于发送结果无法确认的记录，应先核对原邮件回执再处理。

启用新触发器前，先把历史群发的服务器接收回执按账号补录到发信表，并应用 `024_signup_followup_verification_clock.sql` 和 `025_signup_followup_answer_threshold.sql`。专用令牌以 `eqb-followup-` 开头，后接 32 个随机字节的 43 位无填充 Base64URL 编码。在 `signup_followup_scheduler` 保存完整令牌的 SHA-256 摘要，在 Neon Function 端保存 `EQB_FOLLOWUP_SCHEDULER_TOKEN`。

从 `functions/signup-followup` 目录运行 `neon deploy`，指定正式分支和本地密钥文件，并加 `--no-env-pull`。检查触发器计划和 `signup_followup_scheduler.last_checked_at`。部署时可临时创建名为 `signup-followup-probe`、路径为 `/probe` 的触发器。它使用 HEAD 检查正式发信入口的认证，核对通过后删除该临时触发器。 [Neon 定时触发器](https://neon.com/docs/cli/triggers)

## 作者对话与自动回复

发布包含作者对话和聊天区未读红点的版本前，先应用 `018_author_chat.sql` 至 `021_author_chat_contacts.sql`。唯一的管理员是已验证邮箱 `xiaoweihuacqu@gmail.com` 对应的账号。作者可以从联系人列表主动开始私信，欢迎语在用户首次打开作者对话时发送。反馈沿用 QQ SMTP，并使用提交者已验证的邮箱作为回信地址。

在 Makers 的服务端加密变量中配置 `DEEPSEEK_API_KEY`，网关和模型默认值见变量示例。上线群聊主动回复前，先应用 `023_proactive_chat.sql`。群聊通过 @AI 触发，私信通过 @Hua Xiaowei 触发。群聊上一条是 AI 发给同一位用户的回复时，这位用户在 90 秒内的明确追问或调侃也可以直接接续。被 @ 或接续时读取发言者的对话，有选择地插话时读取近期群消息。模型最多参考 50 条历史，历史 JSON 最大 24 KiB。群聊模型可以接收发言者的公开昵称和头像，图片请求被网关拒绝时使用文字。私信只读取当前会话。文本内的邮箱会替换为占位内容，回复在聊天写入完成后生成。

保存或更新生产环境变量后，重新部署 `main`，再核对作者对话和自动回复。Makers 将环境变量变更应用到后续部署。 [Makers 环境变量说明](https://pages.edgeone.ai/document/build-guide#environment-variable)

在预览验证两个账号的首条欢迎语、搜索和未读清除，分别实发群聊和私信的 @，确认 Makers 能在响应结束后写回回复。用授权测试邮箱提交一条仅评价的反馈，并核对收件内容及回信地址。

## 内容同步


运行迁移和题库同步的账号持有发布权限。在本地安全环境注入对应连接串，先运行 `pnpm run db:migrate`，再执行 `pnpm run content:sync -- --release`。校验通过后，使用同一 Git 提交执行 `pnpm run content:sync -- --release --apply`，然后部署该提交。生产构建同样执行覆盖与质量门禁。

同一份 Git 内容派生 CDN 分片和 PostgreSQL 投影。用 `/bank/manifest.json` 的 release 值对照 PostgreSQL 的 `content_release.digest`。命中的 CDN 分片按哈希长期缓存，入口重新验证。题目内容摘要参与同步判分，过期作答提示未保存。公开 API 的 DB 兜底缓存可通过带发布密钥的 `POST /api/internal/invalidate` 失效。

练习入口和在线客户端通过发布摘要验证静态清单。清单摘要和数据库发布摘要一致时读取静态分片，切换期间从当前数据库读取。专题列表和首批题目的缓存按发布摘要隔开。验证时对照 `/api/public/bank-release`、`/api/public/topics` 和静态清单。

开发项目的 `production` 是 Neon 自动创建的默认分支名，当前只用于预览联调。Neon CLI 同步的 `DATABASE_URL` 给 Node 应用，`DATABASE_URL_UNPOOLED` 给迁移与导入。向隔离的 Neon 开发库落预览题使用 `pnpm run content:sync -- --preview --apply`。

发布顺序保存在 `content/question-order.json`。新增或修订的已审核题使用新题和选项 UUID，用 `node scripts/content/release.ts order` 将新题登记到末尾。专题与全库的顺序读取共用这一顺序，随机刷题沿用原有种子规则。

下架时在 JSON 将题目标记为 `withdrawn`，保留原题内容、ID 与顺序记录。同步在事务内校验已登记版本，停用旧题并发布新题。同时清除旧题在收藏、学习进度和错题中的状态，将顺序、专题、收藏与错题练习的已保存位置对齐到原题或相邻的可用题。新题从未作答、未收藏开始。旧试卷从原有快照读取，之后重考只纳入当前可用的原题。同步后失效 API 缓存并重新部署，验证新 manifest 和线上目录均已移除旧题。需要即时撤下旧哈希资源时在 Makers 清除对应路径。已离线设备恢复联网后重验目录。

## 回滚与备份

代码回滚使用 Git revert 或已核实的 Makers 旧部署。内容回滚通过新目录发布，已下架内容恢复收录时使用新 ID。生产用户数据单独备份到用户控制的加密位置，经授权操作员用 `pg_dump`/恢复实例定期验证。Auth 管理由 Neon 提供，恢复演练应覆盖会话和身份匹配。

对比上线前后提交、Makers 构建日志、域名 TLS 结果、目录 release、同域登录和真实数据库写入。大陆移动、联通、电信的冷、热访问采样方法见 [性能验证](PERFORMANCE.md#上线后的大陆实测)。

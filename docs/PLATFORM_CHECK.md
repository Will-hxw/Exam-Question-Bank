# EdgeOne Makers 与 Neon 可行性核查

核查日期为 2026-11-23（Asia/Singapore）。

| 路径 | 本轮证据 | 状态 |
| --- | --- | --- |
| PostgreSQL 读写 | 从 Ubuntu 软件源提取 PostgreSQL 16.15，在 WSL 启动仅监听环回的独立实例。实际执行了建临时表、写入、查询、`pg_trgm` 加载和回滚，Windows 到该端口的 TCP 探测成功 | 已验证本地数据库环境 |
| Next.js 16 / 同域 Route Handler / ISR | 官方指南明确列出支持，尚无项目部署和缓存命中证据 | 待预览部署 |
| Neon 新加坡数据库 / Managed Better Auth | 区域与接口已有官方依据。浏览器已进入 Neon 控制台的首次组织设置，需先提供 Organization name 和用途，尚未创建开发项目 | 待完成组织设置 |
| QQ SMTP | Neon 自定义 SMTP 支持 465，尚无认证与投递记录 | 待控制台配置及实测 |
| 正式域名 | 公共 DNS 指向 Makers。两条公开 A 地址均可直连通过证书校验，首页均返回 `404` | 已解析，应用尚不可用 |
| GitHub 自动部署及大陆三网 | GitHub 确认原仓库为公开仓库，默认分支为 `main`，本轮远端提交为 `5e8d8ea`。远端 API 返回 `protected: false`、空部署列表及空提交状态列表。Makers 控制台入口停在腾讯云登录页，实际项目归属和连接状态仍待确认 | 待控制台登录及实测 |

## Makers 构建、域名与缓存

- Next.js App Router 保持服务端构建，采用 `npm ci`、`npm run build` 和 `.next`。Makers 支持 Next.js 16 与 Route Handlers，列出预装 Node 22 和 24 的多个版本。本机 Node 为 24.5.0，云端构建与函数执行的版本分别从实际日志采证。配置重写时使用平台的 `edgeone.json`。[Next.js 指南](https://pages.edgeone.ai/document/framework-nextjs) · [构建指南](https://pages.edgeone.ai/document/build-guide)
- 导入原仓库 `Will-hxw/Exam-Question-Bank`。授权范围限定该仓库，Production 关联 `main`，Preview 使用隔离数据库及 Auth 设置。在 GitHub 给 `main` 配置必需检查，或将必要验证接入 Makers 构建命令。先验证预览环境，再设置生产构建。应用构建期间保持生产数据库迁移和内容发布独立。[Git 导入](https://pages.edgeone.ai/document/importing-a-git-repository) · [构建环境](https://pages.edgeone.ai/document/build-guide)
- 选择全球可用区（不含中国大陆）。海外免费云函数默认 `ap-singapore`，免费版固定区域。Makers 官网给出的免费云函数月额度为 100 万次、50,000 GB-s、5 GB 函数传输，超过额度对应功能受限。默认项目域名及部署域名在大陆的预览链接有效期为 3 小时，正式接入使用自定义域名。[域名和区域](https://pages.edgeone.ai/document/domain-overview) · [云函数](https://pages.edgeone.ai/document/cloud-functions) · [套餐比较](https://pages.edgeone.ai/document/billing-plan-comparison)
- Google 与 Cloudflare 公共 DoH 均返回 `cqu.xiaoweihua.cn CNAME cqu.xiaoweihua.cn.pages.dnsoe6.com`，TTL 为 600 秒，根域权威 NS 是 DNSPod 的 `lark.dnspod.net` 和 `tree.dnspod.net`。本地代理和直连的默认 DNS 表现有差异。使用公开 DNS 得到的两条 A 地址作 `curl --noproxy "*" --resolve` 直连，保留原主机名和 TLS 校验，两次均得到 `404` 与 `Server: edgeone makers`。下一步在 Makers 的域名管理中核对现有 `cqu` 绑定的项目、环境、证书状态和部署。如果该项目已是预定项目，沿用控制台确认的现有 CNAME。当前未改动任何 DNS。[域名配置](https://pages.edgeone.ai/document/custom-domain)
- Makers 文档明确说明了静态资源的边缘缓存和 Next ISR，需在真实部署确认按查询参数区分的公开 JSON 响应能否缓存和失效。静态应用壳与带哈希 JS/CSS 可走边缘缓存。公开目录/首批题使用从 DB 派生的缓存，候选方案是 Next Data Cache/ISR；参数归一化并限量，服务端不读取 Cookie，不写 Cookie，浏览器公共请求使用 `credentials: 'omit'`。认证、私人数据、考试状态和写接口在成功及错误响应上均用 `private, no-store`，SW 仅缓存白名单内的公开内容。[Makers 缓存](https://pages.edgeone.ai/document/configuring-cache) · [Next.js 指南](https://pages.edgeone.ai/document/framework-nextjs)
- 发布/修题/下架的失效验证要串联数据库提交与受保护的失效调用。Next.js 16 在 Route Handler 中可用 `revalidateTag(tag, { expire: 0 })` 立即停止旧 Data Cache 服务，`"max"` 允许短暂返回旧内容。按需 `revalidatePath` 在下一次访问重新生成指定路由，跨路由共享数据还需标签失效。Makers 外层缓存若另外存了响应，要测其是否仍命中旧内容。验收保存同一 URL 冷读/热读的缓存证据、实际响应体、DB 修改后首次读取结果，以及两个账号各自的私人响应。[Next.js 标签失效](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) · [Next.js 路径失效](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)

## Neon 认证与 PostgreSQL

- Neon 区域选择 `aws-ap-southeast-1`（新加坡），开发与生产分别配置数据库和 Auth。新项目 Free 文档列明每项目 1 GB 存储、100 CU-hours/月、5 GB 出站，闲置 5 分钟休眠。使用 Neon HTTP 驱动时，多条 SQL 只能借助非交互式事务，依赖上一语句结果的作答或交卷逻辑应由原子 SQL 封装，或用支持交互事务的连接方式并实测云函数兼容性。开发阶段可先用相同 PostgreSQL SQL 在本机/CI 验证，由 Preview 再验证 Neon 连接、缓存和冷启动。[Neon 区域](https://neon.com/docs/introduction/regions) · [计划](https://neon.com/docs/introduction/plans) · [驱动](https://neon.com/docs/serverless/serverless-driver)
- npm 发布件 `@neon/auth@0.8.2` 含 `@neon/auth/next` 与 `@neon/auth/next/server`。前端使用 `createAuthClient()`，服务端用 `createNeonAuth()`，转发到本站 `/api/auth/[...path]`。正式 Cookie 不设置父域 `.xiaoweihua.cn`，部署后检查 `Secure`、`HttpOnly`、`SameSite` 和作用域。已核对该版本 SDK 源码，`getSession({ query: { disableCookieCache: "true" } })` 跳过默认 300 秒的签名会话数据缓存。这里需要字符串 `"true"`，将 TTL 设为 0 则会被 SDK 拒绝。敏感写入、删除及撤销后的授权验收使用新鲜会话，并检查 `user.emailVerified`。[Next.js API 接入](https://neon.com/docs/auth/quick-start/nextjs-api-only) · [服务端 SDK](https://neon.com/docs/auth/reference/nextjs-server)
- Neon 支持注册验证 OTP、`emailOtp.sendVerificationOtp` 重发、`emailOtp.verifyEmail` 验证、`forgetPassword.emailOtp` 发重置码和 `emailOtp.resetPassword` 重置。控制台在对应 Auth 分支启用邮箱注册、Verify at Sign-up、Verification code 和 Revoke sessions on password reset。正式 Trusted Domains 只添加 `https://cqu.xiaoweihua.cn` 并关闭 Allow Localhost，开发在独立 Auth 分支保留 localhost。限流按邮箱和 IP 分级持久化，须覆盖直接调用同域邮件发送接口的路径。[邮箱验证](https://neon.com/docs/auth/guides/email-verification) · [Email OTP](https://neon.com/docs/auth/guides/plugins/email-otp) · [密码重置](https://neon.com/docs/auth/guides/password-reset) · [可信域名](https://neon.com/docs/auth/guides/configure-domains)
- 服务端 SDK 暴露 `deleteUser()`。上线验收应在获授权的测试账户上确认 Auth 删除是否成功、旧会话是否拒绝、本站学习数据能否安全清除。应用不直接修改 `neon_auth` 托管表。托管身份和本站学习数据在分步骤删除时，要保留可重试或可核对的失败状态。[服务端 SDK](https://neon.com/docs/auth/reference/nextjs-server#authdeleteuser)

## 控制台待办与实测

1. 在 Neon 创建隔离的新加坡开发和生产环境，明确开发环境不含生产用户。向应用执行环境注入 `DATABASE_URL`、`NEON_AUTH_BASE_URL`、至少 32 字符的 `NEON_AUTH_COOKIE_SECRET` 和该环境的站点 URL。先在开发环境执行迁移、读一条集成测试题、进行一次验证身份后的写入及跨账号拒绝测试。
2. 在 QQ 邮箱账户安全设置启用 SMTP 并新建专用授权码。在 Neon 对应 Auth 分支进入 Settings → Better Auth → Email provider，选择 Custom SMTP，设置 `smtp.qq.com`、`465`、SSL/TLS、用户名与发件邮箱均为 `1176843521@qq.com`，发件名使用本站名称，授权码仅填安全控制台。自定义 SMTP 默认沿用 Neon 模板。以 QQ 和 163 的已授权收件人实测注册、重发、验证码过期和重放、重置与旧密码或旧会话失效。[Neon 配置指南](https://neon.com/docs/auth/production-checklist) · [腾讯云 SMTP 参数](https://cloud.tencent.com/document/api/876/34822)
3. 在现有 Makers 项目确认仓库绑定和生产分支。预览测试通过后，经 PR 合入 `main`，获取自动构建所用的提交、部署记录和正式域名的响应。确认现有 `cqu` CNAME 与 Makers 控制台匹配，启用免费证书及续签。只按控制台要求核验或配置 `cqu` 记录及该子域的验证记录。
4. 记录大陆移动、联通、电信的两个时段，分开测冷、热访问，保留首批题可作答、已预取切题、搜索、登录、真实邮件收取、保存、恢复和另一设备读取结果。当前 DNS/TLS 检查用于定位正式入口，性能验收仍待执行。

## 定制 OTP 邮件预览

独立预览分支使用 Neon `send.otp` Webhook 接管邮箱验证和密码重置的投递。Neon Auth 内置 Custom SMTP 和 Application Name 仍可作回退。控制台里的 SMTP 发件人设置无法替换 Neon 的 HTML 模板，订阅 `send.otp` 后 Neon 会停止对应的默认邮件。认证中的验证码仍由 Neon 生成、校验和作废。[自定义邮件](https://neon.com/docs/auth/guides/customize-emails) · [Webhook 接口](https://neon.com/docs/auth/guides/webhooks)

1. 在隔离预览环境迁移 `002_auth_rate_limits.sql` 和 `004_auth_otp_deliveries.sql`，按环境注入 Neon 连接和认证变量。Makers Preview 安全环境变量中设 `NEON_OTP_WEBHOOK_ENABLED=true`、`NEON_OTP_WEBHOOK_ENDPOINT_ID` 为该 Neon Auth 的签名事件 `context.endpoint_id`，`QQ_SMTP_AUTH_CODE` 为专用授权码。启用前检查预览函数产物包含 `public/brand-mark.png`。缺图时按纯文字品牌头排版，邮件仍可用。
2. 在开发 Neon Auth 分支添加 Webhook `https://<独立预览域名>/api/webhooks/neon`，仅订阅 `send.otp`。单次超时可设为 10 秒，官方整个阻塞事件最多 3 次且总计不超过 15 秒。测试实际量取 JWKS、数据库、QQ SMTP 连接和投递时间，确认函数能用证书校验的 TLS 访问 `smtp.qq.com:465`。
3. 仅用授权收件人测试 QQ/163 正常投递、验证码错误/过期/重放、重置后的旧密码及旧会话失效。同一个已投递事件重复提交应返回成功且只投递一次。重试会复用事件 ID。遇 SMTP 接受情况不明时，同一条事件不会贸然重发，接口明确返回投递失败；用户可重新请求验证码。清除试验前先关闭 Neon 的该事件订阅，使默认发信恢复，再取消预览的 Webhook 开关和 SMTP 授权码。

本地已在真实 PostgreSQL 16.15 上完成两张认证表迁移。使用合成上游联调同域 API，匿名及未验证会话返回 200 和空用户，已验证会话返回用户，上游故障返回 503，以上响应均为 `private, no-store`。跨源注册返回 403。同一邮箱 10 次并发注册请求中 4 次通过限流、6 次返回 429。12 次并发领取同一投递事件时，首次只有一个领取成功，发送中拒绝重复领取，记录临时失败后仅一个重试获准，标记成功后拒绝再次领取。该检查验证数据库并发，不涉及 SMTP。

签名单测使用合成 Ed25519 密钥，覆盖正确签名、重排 JSON、伪造事件 ID、跨 Neon endpoint、时效和投递用途。390px [登录页](baseline/new-login-390.png) 来自本地生产构建。浏览器用合成 API 走通注册、验证和密码重置的界面与请求。390px [邮件预览](baseline/new-email-390.png) 使用合成验证码，尚无 QQ/163 实收或 Makers 预览函数投递证据。

数据库仅保存事件 UUID、状态、尝试次数、失败类别和时间。验证码、邮件内容、邮箱和 SMTP 凭据无持久记录。限流键是使用服务端密钥计算的 HMAC。上线前确认 Makers Next 路由获取到的是由平台注入的 `EO-Connecting-IP`。没有有效 IP 时，网络维度退回共享计数桶，邮箱维度仍分别计数。运维清理可删除已过期的限流计数和超过观察窗口的投递记录。

# Makers 与 Neon 部署

## 预览与生产环境

1. Makers 控制台已核对项目为 `examquestionbank`，域名 `cqu.xiaoweihua.cn` 现有绑定继续使用。公共 DNS 指向 `cqu.xiaoweihua.cn.pages.dnsoe6.com`，TLS 已通过，初次核查首页返回 404。所有 DNS 操作限 `cqu`。 [平台核查](PLATFORM_CHECK.md)
2. 由 Makers 导入 `Will-hxw/Exam-Question-Bank`，选全球可用区（不含中国大陆），生产分支选 `main`。构建使用 Node.js 24.5.0、`npm ci --include=dev`、`npm run build` 和 `.next`。预览分支使用隔离数据库、独立 Neon Auth、测试邮件。
3. 在新加坡创建独立 PostgreSQL 与 Neon Managed Better Auth。配置 `DATABASE_URL`、`NEON_AUTH_BASE_URL`、随机 `NEON_AUTH_COOKIE_SECRET`、`NEXT_PUBLIC_SITE_URL` 和独立 `CONTENT_INVALIDATION_SECRET`。应用运行环境由服务端使用。生产 `NEXT_PUBLIC_SITE_URL` 为 `https://cqu.xiaoweihua.cn`，正式 Auth Trusted Domains 只允许该站点。
4. 开启邮箱注册、注册验证、验证码及密码重置后撤销会话。生产设置 `REQUIRE_COMPLETE_BANK=1`。配置 GitHub 必需检查，先等预览证据齐全再合入生产分支。

## 中文验证码邮件的预览试验

1. 在 QQ 邮箱启用 SMTP，生成专用授权码。只在 Makers **预览环境**的安全变量中填 `QQ_SMTP_AUTH_CODE`，并设置 `NEON_OTP_WEBHOOK_ENDPOINT_ID`。发送使用 `1176843521@qq.com`、`smtp.qq.com:465`、TLS。
2. 在独立 Neon Auth 环境把签名 `send.otp` 事件投递到预览站 `/api/webhooks/neon`。启用 `NEON_OTP_WEBHOOK_ENABLED=true` 后，先在预览执行签名验证、TCP/TLS 和两种邮箱的真实送达验证，再测试验证码有效期、重放、找回密码及旧会话失效。只向本人或授权收件人测试。
3. Neon 注册该事件后由 Webhook 负责发送。若预览卡在 Makers 465 出站或 QQ 投递，停用该 webhook 订阅可恢复托管邮件流程。托管模式可在 Neon 控制台设置 QQ 发件账号及应用名，正文使用 Neon 模板。 [Neon 邮件定制](https://neon.com/docs/auth/guides/customize-emails) · [Webhook 协议](https://neon.com/docs/auth/guides/webhooks)

当前项目已在 Makers 设置页将 QQ 授权码、开发 Neon 连接及认证配置限定为预览，并开启预览分支自动部署。开发机用 QQ SMTP 通过 TLS 和账号认证，QQ 接收服务器接受一封发给项目邮箱的模板联调邮件。

已在带 Makers 访问权限的浏览器确认 `examquestionbank-dp1bq9eap2wu.edgeone.cool` 页面、健康接口与 131 道题清单正常，数据库同步后的公开专题接口也返回 131 道。未经预览授权的请求可能被 Makers 拒绝。腾讯云域名管理显示 `cqu.xiaoweihua.cn` 的解析和证书已生效，关联生产环境。生产入口仍返回 Makers 的 404。用户选择继续通过现有预览评测，正式域维持生产关联。

在 Neon 评测分支加入已验证的预览 URL 后，实际登录接口从 403 `INVALID_ORIGIN` 变为对测试地址正常返回 401 `INVALID_EMAIL_OR_PASSWORD`。重复注册既有待验证账号返回 200，但未生成新验证码。显式重发生成有效验证码，Neon 评测分支临时使用 QQ SMTP 托管模板期间，用户已完成邮箱验证，浏览器会话接口返回已验证用户。

预览已启用签名 `send.otp` 回调。Neon Auth 只生成验证码和管理身份，邮件由本站 Next.js 后端用 `otp-template.ts` 渲染，通过 QQ SMTP 直发。用已验证的评测账号触发一次密码重置验证码，实际认证接口返回 200，数据库投递记录为 `sent`、`attempts: 1`。QQ SMTP 已接受自定义模板邮件，收件箱显示由评测人确认。

回调当前指向已验证的预览部署域名。更换部署域名时，将新域名加入 Neon 可信域名，先确认回调 API 可用，再更新回调端点和实测投递。正式环境使用正式域名及独立配置。

## 内容同步

运行迁移和题库同步的账号持有发布权限。在本地安全环境注入对应连接串，先运行 `npm run db:migrate`，再执行 `npm run content:sync -- --release`。校验通过后，使用同一 Git 提交执行 `npm run content:sync -- --release --apply`，然后部署该提交。生产构建同样执行覆盖与质量门禁。

同一份 Git 内容派生 CDN 分片和 PostgreSQL 投影。用 `/bank/manifest.json` 的 release 值对照 PostgreSQL 的 `content_release.digest`。命中的 CDN 分片按哈希长期缓存，入口重新验证。题目内容摘要参与同步判分，过期作答提示未保存。公开 API 的 DB 兜底缓存可通过带发布密钥的 `POST /api/internal/invalidate` 失效。

开发项目的 `production` 是 Neon 自动创建的默认分支名，当前只用于预览联调。Neon CLI 同步的 `DATABASE_URL` 给 Node 应用，`DATABASE_URL_UNPOOLED` 给迁移与导入。向隔离的 Neon 开发库落预览题使用 `npm run content:sync -- --preview --apply`。

紧急下架时在 JSON 标记题目为 `withdrawn`，同步数据库、失效 API 缓存并重新部署。验证新 manifest 和线上目录均不再返回该题。需要即时撤下旧哈希资源时在 Makers 清除对应路径。已离线设备恢复联网后重验目录。

## 回滚与备份

代码回滚使用 Git revert 或已核实的 Makers 旧部署。内容回滚保留已有 UUID 和已退役条目，在 Git 中审查回滚内容，重新同步并发布。生产用户数据单独备份到用户控制的加密位置，经授权操作员用 `pg_dump`/恢复实例定期验证。Auth 管理由 Neon 提供，恢复演练应覆盖会话和身份匹配。

对比上线前后提交、Makers 构建日志、域名 TLS 结果、目录 release、同域登录和真实数据库写入。中国大陆移动、联通、电信至少分两个时段测冷、热访问。当前账户及三网实测均未完成。

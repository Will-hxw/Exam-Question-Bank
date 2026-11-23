import type { OtpEvent } from "./neon-webhook"

export const practiceSiteName = "重庆大学入党积极分子练习"
export const brandImageCid = "practice-brand@cqu.xiaoweihua.cn"

export function otpTemplate(
  event: Pick<OtpEvent, "purpose" | "code" | "expiresAt">,
  hasBrandImage: boolean,
  now = Date.now(),
) {
  const reset = event.purpose === "forget-password"
  const subject = `${practiceSiteName} · ${reset ? "密码重置验证码" : "邮箱验证码"}`
  const title = reset ? "重置密码" : "验证邮箱"
  const instruction = reset ? "请在重置密码页面输入以下验证码。" : "请在验证邮箱页面输入以下验证码。"
  const minutes = Math.floor((event.expiresAt - now) / 60_000)
  const validity = minutes > 0
    ? `请在 ${minutes} 分钟内使用，此验证码仅可使用一次。`
    : "验证码即将过期，请尽快使用。"
  const footer = "如非本人操作，可忽略这封邮件。"
  const mark = hasBrandImage
    ? `<td width="52" style="vertical-align:middle"><img src="cid:${brandImageCid}" width="38" height="38" alt="" style="display:block;border:0;border-radius:9px"></td>`
    : ""

  return {
    subject,
    text: [practiceSiteName, title, instruction, event.code, validity, footer].join("\n\n"),
    html: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f2f7;color:#202440;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f2f7">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:500px;border:1px solid #dcdcec;border-radius:14px;background:#ffffff">
<tr><td style="padding:24px 26px;border-bottom:1px solid #eeedf5">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>${mark}
<td style="font-size:15px;font-weight:650;line-height:1.5;vertical-align:middle;color:#272746">${practiceSiteName}</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 26px 24px">
<h1 style="margin:0 0 12px;font-size:23px;line-height:1.35;letter-spacing:0.02em;color:#202440">${title}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#454664">${instruction}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td align="center" style="padding:17px 10px;background:#efedff;border-radius:7px;color:#332875;font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:600;line-height:1.2;letter-spacing:0.13em;white-space:nowrap">${event.code}</td></tr>
</table>
<p style="margin:13px 0 0;color:#52526c;font-size:13px;line-height:1.65">${validity}</p>
</td></tr>
<tr><td style="padding:17px 26px 19px;border-top:1px solid #eeedf5;color:#52526c;font-size:13px;line-height:1.6">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  }
}

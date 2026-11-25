import type { OtpEvent } from "./neon-webhook"

export const practiceSiteName = "重庆大学入党积极分子练习"
export const crestContentId = "cqu-crest@cqu.xiaoweihua.cn"

export function otpTemplate(
  event: Pick<OtpEvent, "purpose" | "code" | "expiresAt">,
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
  return {
    subject,
    text: [practiceSiteName, title, instruction, event.code, validity, footer].join("\n\n"),
    html: practiceMailHtml(subject, `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.3;color:#202632">${title}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#596575">${instruction}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td align="center" bgcolor="#edf3fb" style="padding:17px 10px;background:#edf3fb;border-radius:7px;color:#1e4f91;font-family:'Times New Roman',Georgia,serif;font-size:32px;font-weight:600;line-height:1.2;letter-spacing:0.14em;white-space:nowrap">${event.code}</td></tr>
</table>
<p style="margin:13px 0 0;color:#596575;font-size:14px;line-height:1.65">${validity}</p>`, footer),
  }
}

export function practiceMailHtml(subject: string, body: string, footer: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;color:#202632;font-family:'Noto Sans SC','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f9fafb" style="background:#f9fafb">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:500px;border:1px solid #d7e1ee;border-radius:14px;background:#ffffff">
<tr><td style="padding:24px 26px;border-bottom:1px solid #d7e1ee">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="padding-right:10px"><img src="cid:${crestContentId}" alt="" width="32" height="32" style="display:block"></td>
<td style="font-family:'Noto Sans SC','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',Arial,sans-serif;font-size:17px;font-weight:600;line-height:1.5;color:#202632">${practiceSiteName}</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 26px 24px;font-family:'Noto Sans SC','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',Arial,sans-serif">
${body}
</td></tr>
<tr><td style="padding:17px 26px 19px;border-top:1px solid #d7e1ee;color:#596575;font-family:'Noto Sans SC','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',Arial,sans-serif;font-size:14px;line-height:1.6">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

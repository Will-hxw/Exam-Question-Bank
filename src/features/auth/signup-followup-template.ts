import { practiceMailHtml, practiceSiteName } from "./otp-template.ts"

export const signupFollowupSite = "https://cqu.xiaoweihua.cn"
export const signupFollowupPath = "/api/internal/signup-followup"

export function signupFollowupTemplate(sender: string, now = new Date()) {
  const site = signupFollowupSite + "/"
  const feedback = site + "#feedback"
  const organization = practiceSiteName + "平台"
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  const date = `${dateParts.year} 年 ${dateParts.month} 月 ${dateParts.day} 日`
  const title = "欢迎把题库分享给同学"
  const subject = practiceSiteName + " · " + title
  const shareStart = "感谢您使用练习平台。若题库对您有帮助，"
  const invitation = "欢迎分享给身边的同学"
  const shareEnd = "，也欢迎日后推荐给学弟学妹。"
  const rating = "「夯爆了」还是「拉完了」"
  const feedbackText = "已上线，欢迎告诉我们您的体验是"
  const compensation = "如您使用本平台备考后未通过本次结业考试，可联系下方邮箱申请补偿。"
  const paragraph = "margin:0 0 14px;font-size:15px;line-height:1.7;color:#596575"
  const emphasis = "color:#202632;font-weight:600"
  const linkStyle = "color:#1e4f91;text-decoration:underline"
  const body = `<h1 style="margin:0 0 12px;font-size:28px;line-height:1.3;color:#202632">${title}</h1>
<p style="${paragraph}">您好！</p>
<p style="${paragraph}">${shareStart}<strong style="${emphasis}">${invitation}</strong>${shareEnd}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td align="center" bgcolor="#edf3fb" style="background:#edf3fb;border-radius:7px">
<a href="${feedback}" style="display:block;padding:15px 12px;color:#1e4f91;font-size:16px;font-weight:600;line-height:1.3;text-decoration:none">意见反馈</a>
</td></tr></table>
<p style="margin:14px 0;font-size:15px;line-height:1.7;color:#596575"><a href="${feedback}" style="${linkStyle}">意见反馈</a>${feedbackText}<strong style="${emphasis};white-space:nowrap">${rating}</strong>。</p>
<p style="margin:0;font-size:15px;line-height:1.7;color:#596575">${compensation}</p>
<p style="margin:21px 0 0;text-align:right;font-size:14px;line-height:1.65;color:#596575">${organization}<br>${date}</p>`
  const footer = `联系邮箱 <a href="mailto:${sender}" style="${linkStyle}">${sender}</a><br>分享链接 <a href="${site}" style="${linkStyle}">cqu.xiaoweihua.cn</a>`
  const text = [
    practiceSiteName, title, "您好！", shareStart + invitation + shareEnd,
    "意见反馈 " + feedback, "「意见反馈」" + feedbackText + rating + "。", compensation,
    organization + "\n" + date, "联系邮箱 " + sender + "\n分享链接 " + site,
  ].join("\n\n")

  return { subject, text, html: practiceMailHtml(subject, body, footer) }
}

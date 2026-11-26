export function feedbackMail(rating: string, message: string, email: string) {
  return {
    replyTo: { name: '', address: email },
    subject: `【练习站意见反馈】${rating}`,
    text: `整体评价：${rating}\n注册邮箱：${email}${message ? `\n\n意见或建议：\n${message}` : ''}`,
  }
}

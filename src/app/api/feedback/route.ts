import { sendQqMail, smtpFailure } from '@/features/auth/qq-mail'
import { feedbackRetryAfter } from '@/features/auth/rate-limit'
import { feedbackMaxLength, feedbackRatings } from '@/features/study/feedback'
import { HttpError, parseBody, route } from '@/server/http'
import { account } from '@/server/learning'

export const runtime = 'nodejs'

export const POST = route(async (request: Request) => {
  const userId = await account(request, true)
  const body = await parseBody(request, 8 * 1024)
  const rating = feedbackRatings.find((value) => value === body.rating)
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!rating || !message || message.length > feedbackMaxLength) {
    throw new HttpError(400, `请选择一档评价，并填写 ${feedbackMaxLength} 字以内的反馈。`)
  }

  const code = process.env.QQ_SMTP_AUTH_CODE
  if (!code) throw new HttpError(503, '暂时无法提交反馈，请稍后再试。')
  const retryAfter = await feedbackRetryAfter(userId)
  if (retryAfter > 0) {
    throw new HttpError(429, `提交过于频繁，请在 ${Math.ceil(retryAfter / 60)} 分钟后再试。`)
  }

  try {
    await sendQqMail(code, {
      to: 'xiaoweihuacqu@gmail.com',
      subject: `【练习站意见反馈】${rating}`,
      text: `整体评价：${rating}\n\n意见或建议：\n${message}`,
    })
  } catch (error) {
    const failure = smtpFailure(error)
    console.error({ operation: 'feedback-mail', reason: failure.reason })
    if (failure.state === 'uncertain') {
      throw new HttpError(503, '暂未确认发送结果，请稍后再试。')
    }
    throw new HttpError(503, '反馈暂未发出，请稍后重试。')
  }

  return { sent: true }
})

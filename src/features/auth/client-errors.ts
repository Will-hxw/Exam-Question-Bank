import { isAuthError } from "@neon/auth/next"

type AuthIssue = { status?: number; code?: string }

function readIssue(error: unknown): AuthIssue | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const status = "status" in error && typeof error.status === "number" ? error.status : undefined
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined
  return status !== undefined || code !== undefined ? { status, code } : undefined
}

export function authIssue(error: unknown): AuthIssue | undefined {
  if (isAuthError(error) && "error" in error) {
    // Neon normalizes the outer error and keeps the original response in `error`.
    const upstream = readIssue(error.error)
    return { status: upstream?.status ?? error.status, code: upstream?.code ?? error.code }
  }
  return readIssue(error)
}

export function authErrorMessage(issue: AuthIssue, fallback: string) {
  if (issue.status === 429) return "尝试次数过多，请稍后再试。"
  if (issue.status && issue.status >= 500) return "认证服务暂时不可用，请稍后再试。"

  switch (issue.code) {
    case "INVALID_ORIGIN":
      return "当前访问地址未通过认证，请使用站点提供的有效链接重试。"
    case "INVALID_OTP":
      return "验证码有误，请核对后重试。"
    case "OTP_EXPIRED":
      return "验证码已过期，请重新发送。"
    case "INVALID_AUTH_INPUT":
      return "请检查邮箱、密码和验证码的格式。"
    case "PASSWORD_TOO_SHORT":
      return "密码至少需要 8 个字符。"
    case "PASSWORD_TOO_LONG":
      return "密码最多可使用 128 个字符。"
    default:
      return fallback
  }
}

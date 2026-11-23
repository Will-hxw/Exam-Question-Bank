import { isAuthError } from "@neon/auth/next"

type AuthIssue = { status?: number; code?: string }
export type AuthStep = "login" | "register" | "verify" | "forgot" | "reset"
export type AuthField = "email" | "password" | "otp"
type FieldError = { field: AuthField; text: string }

const invalidOtp = "验证码错误，请重试。"
const expiredOtp = "验证码已过期，请重新发送。"
const shortPassword = "密码至少需要 8 个字符。"
const longPassword = "密码最多可使用 128 个字符。"

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
      return invalidOtp
    case "OTP_EXPIRED":
      return expiredOtp
    case "INVALID_AUTH_INPUT":
      return "请检查邮箱、密码和验证码的格式。"
    case "PASSWORD_TOO_SHORT":
      return shortPassword
    case "PASSWORD_TOO_LONG":
      return longPassword
    default:
      return fallback
  }
}

export function authFieldError(step: AuthStep, issue: AuthIssue): FieldError | undefined {
  if (issue.status === 429 || (issue.status ?? 0) >= 500) return undefined

  switch (issue.code?.toUpperCase()) {
    case "EMAIL_ALREADY_REGISTERED":
    case "EMAIL_ALREADY_EXISTS":
    case "EMAIL_EXISTS":
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return step === "register" ? { field: "email", text: "该邮箱已注册，请登录。" } : undefined
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_CREDENTIALS":
      return step === "login" ? { field: "password", text: "邮箱或密码有误，请检查后重试。" } : undefined
    case "INVALID_PASSWORD":
      return step === "login" ? { field: "password", text: "密码错误，请重试。" } : undefined
    case "INVALID_OTP":
    case "OTP_INVALID":
    case "INVALID_VERIFICATION_CODE":
      return step === "verify" || step === "reset" ? { field: "otp", text: invalidOtp } : undefined
    case "OTP_EXPIRED":
    case "EXPIRED_OTP":
      return step === "verify" || step === "reset" ? { field: "otp", text: expiredOtp } : undefined
    case "PASSWORD_TOO_SHORT":
      return step === "register" || step === "reset" ? { field: "password", text: shortPassword } : undefined
    case "PASSWORD_TOO_LONG":
      return step === "register" || step === "reset" ? { field: "password", text: longPassword } : undefined
    default:
      return undefined
  }
}

export function authConstraintError(name: string, validity: Pick<ValidityState, "valueMissing" | "tooLong">): FieldError | undefined {
  switch (name) {
    case "email":
      return { field: name, text: validity.valueMissing ? "请输入邮箱。" : "请输入有效的邮箱地址。" }
    case "password":
      if (validity.valueMissing) return { field: name, text: "请输入密码。" }
      return { field: name, text: validity.tooLong ? longPassword : shortPassword }
    case "otp":
      return { field: name, text: "请输入 6 位验证码。" }
    default:
      return undefined
  }
}

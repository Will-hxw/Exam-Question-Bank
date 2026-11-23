"use client"

import Image from "next/image"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { authClient } from "./client"
import styles from "./auth-panel.module.css"

type Step = "login" | "register" | "verify" | "forgot" | "reset"
type AuthIssue = { status?: number; code?: string } | null | undefined

const views: Record<Step, { title: string; description: string; action: string }> = {
  login: {
    title: "登录",
    description: "登录后开始练习，答题记录会保存到你的账号。",
    action: "登录",
  },
  register: {
    title: "创建账号",
    description: "使用邮箱注册，并完成邮箱验证。",
    action: "注册并验证邮箱",
  },
  verify: {
    title: "验证邮箱",
    description: "输入发至邮箱的 6 位验证码。",
    action: "验证邮箱",
  },
  forgot: {
    title: "找回密码",
    description: "输入注册时使用的邮箱，获取密码重置验证码。",
    action: "发送重置验证码",
  },
  reset: {
    title: "重置密码",
    description: "输入邮箱验证码，并设置新密码。",
    action: "保存新密码",
  },
}

function messageFor(error: AuthIssue, fallback: string) {
  if (error?.status === 429) return "尝试次数过多，请稍后再试。"
  if (error?.status && error.status >= 500) return "认证服务暂时不可用，请稍后再试。"

  switch (error?.code) {
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

async function sessionIsVerified() {
  const response = await fetch("/api/me/session", { cache: "no-store" })
  if (!response.ok) throw new Error("session lookup failed")
  const { user } = await response.json()
  return Boolean(user?.id)
}

export function AuthPanel() {
  const [step, setStep] = useState<Step>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [errorText, setErrorText] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState<"submit" | "resend" | null>(null)
  const [remaining, setRemaining] = useState(0)
  const inFlight = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const view = views[step]
  const hasOtp = step === "verify" || step === "reset"
  const hasPassword = step === "login" || step === "register" || step === "reset"

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setRemaining((count) => count - 1), 1_000)
    return () => clearTimeout(timer)
  }, [remaining])

  function changeStep(next: Step, nextNotice = "") {
    setStep(next)
    setPassword("")
    setShowPassword(false)
    setOtp("")
    setErrorText("")
    setNotice(nextNotice)
    heading.current?.focus()
  }

  function begin(kind: "submit" | "resend") {
    if (inFlight.current) return false
    inFlight.current = true
    setPending(kind)
    setErrorText("")
    setNotice("")
    return true
  }

  function end() {
    inFlight.current = false
    setPending(null)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!begin("submit")) return

    const address = email.trim().toLowerCase()
    setEmail(address)

    try {
      switch (step) {
        case "login": {
          const { error } = await authClient.signIn.email({ email: address, password })
          if (error?.code === "EMAIL_NOT_VERIFIED") {
            changeStep("verify", "请先完成邮箱验证。需要时可重新发送验证码。")
          } else if (error) {
            setErrorText(messageFor(error, "邮箱或密码有误，请检查后重试。"))
          } else if (await sessionIsVerified()) {
            window.location.replace("/")
          } else {
            changeStep("verify", "请先完成邮箱验证。需要时可重新发送验证码。")
          }
          break
        }
        case "register": {
          const { error } = await authClient.signUp.email({
            email: address,
            password,
            name: "同学",
          })
          if (error) {
            setErrorText(messageFor(error, "注册请求未完成。可检查邮箱后重试，或尝试登录。"))
          } else {
            setRemaining(60)
            changeStep("verify", "如果该邮箱可用于注册，请查收验证码。")
          }
          break
        }
        case "verify": {
          const { error } = await authClient.emailOtp.verifyEmail({ email: address, otp })
          if (error) {
            setErrorText(messageFor(error, "邮箱验证未完成，请检查验证码后重试。"))
          } else if (await sessionIsVerified()) {
            window.location.replace("/")
          } else {
            changeStep("login", "邮箱已验证，请登录。")
          }
          break
        }
        case "forgot": {
          const { error } = await authClient.forgetPassword.emailOtp({ email: address })
          if (error) {
            setErrorText(messageFor(error, "重置请求未完成，请稍后重试。"))
          } else {
            setRemaining(60)
            changeStep("reset", "如果该邮箱已注册，请查收密码重置验证码。")
          }
          break
        }
        case "reset": {
          const { error } = await authClient.emailOtp.resetPassword({
            email: address,
            otp,
            password,
          })
          if (error) {
            setErrorText(messageFor(error, "密码重置未完成，请检查验证码后重试。"))
          } else {
            changeStep("login", "密码已更新，请用新密码登录。")
          }
          break
        }
      }
    } catch {
      setErrorText("暂时无法完成请求，请检查网络后重试。")
    } finally {
      end()
    }
  }

  async function resend() {
    if (remaining > 0 || !begin("resend")) return

    try {
      const { error } = step === "verify"
        ? await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
        : await authClient.forgetPassword.emailOtp({ email })
      if (error) {
        setErrorText(messageFor(error, "验证码请求未完成，请稍后重试。"))
      } else {
        setRemaining(60)
        setNotice("如果该邮箱符合发送条件，请查收邮件。")
      }
    } catch {
      setErrorText("暂时无法发送验证码，请检查网络后重试。")
    } finally {
      end()
    }
  }

  return (
    <main className={styles.screen}>
      <div className={styles.frame}>
        <div className={styles.brand}>
          <Image src="/brand-mark.png" alt="" width={40} height={40} priority />
          <span>重庆大学入党积极分子练习</span>
        </div>

        <div className={styles.heading}>
          <h1 ref={heading} tabIndex={-1}>{view.title}</h1>
          <p>{view.description}</p>
          {hasOtp && <p className={styles.address}>{email}</p>}
        </div>

        <form onSubmit={onSubmit} className={styles.form}>
          {!hasOtp && (
            <div className={styles.field}>
              <label htmlFor="auth-email">邮箱</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                required
              />
            </div>
          )}

          {hasOtp && (
            <div className={styles.field}>
              <label htmlFor="auth-code">验证码</label>
              <input
                id="auth-code"
                name="otp"
                className={styles.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, ""))}
                required
              />
            </div>
          )}

          {hasPassword && (
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor="auth-password">{step === "reset" ? "新密码" : "密码"}</label>
                {step === "login" && (
                  <button type="button" className={styles.link} disabled={!!pending}
                    onClick={() => changeStep("forgot")}>
                    忘记密码
                  </button>
                )}
              </div>
              <div className={styles.password}>
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={step === "login" ? "current-password" : "new-password"}
                  aria-describedby={step === "login" ? undefined : "auth-password-note"}
                  minLength={step === "login" ? undefined : 8}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button type="button" className={styles.toggle}
                  onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
              {step !== "login" && <small id="auth-password-note">至少使用 8 个字符。</small>}
            </div>
          )}

          {errorText && <p className={styles.error} role="alert">{errorText}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}

          <button type="submit" className={styles.submit} disabled={!!pending}>
            {pending === "submit" ? "正在处理…" : view.action}
          </button>
        </form>

        {hasOtp && (
          <div className={styles.resend}>
            <button type="button" className={styles.link} disabled={!!pending || remaining > 0}
              onClick={resend}>
              {pending === "resend" ? "正在请求…"
                : remaining > 0 ? `${remaining} 秒后可重发` : "重新发送验证码"}
            </button>
          </div>
        )}

        <p className={styles.footer}>
          {step === "login" ? (
            <>
              第一次使用？
              <button type="button" className={styles.link} disabled={!!pending}
                onClick={() => changeStep("register")}>
                创建账号
              </button>
            </>
          ) : (
            <button type="button" className={styles.link} disabled={!!pending}
              onClick={() => changeStep("login")}>
              返回登录
            </button>
          )}
        </p>
      </div>
    </main>
  )
}

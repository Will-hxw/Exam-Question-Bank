"use client"

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTabDraft } from "@/use-tab-draft"
import { authConstraintError, authErrorMessage, authFieldError, authIssue, type AuthField, type AuthStep } from "./client-errors"
import { AuthScreen } from "./auth-screen"
import type { StudyDestination } from "./study-destination"
import styles from "./auth-panel.module.css"

type FormError = { text: string; field?: AuthField }
type AuthFlow = { step: AuthStep; email: string; resendAt: number }

const views: Record<AuthStep, { title?: string; description?: string; action: string; failure: string }> = {
  login: { action: "继续", failure: "邮箱或密码有误，请检查后重试。" },
  register: {
    title: "创建账号",
    action: "注册并验证邮箱",
    failure: "注册请求未完成。可检查邮箱后重试，或尝试登录。",
  },
  verify: {
    title: "验证邮箱",
    description: "输入发至邮箱的 6 位验证码。",
    action: "验证邮箱",
    failure: "邮箱验证未完成，请检查验证码后重试。",
  },
  forgot: {
    title: "找回密码",
    description: "输入注册时使用的邮箱，获取密码重置验证码。",
    action: "发送重置验证码",
    failure: "重置请求未完成，请稍后重试。",
  },
  reset: {
    title: "重置密码",
    description: "输入邮箱验证码，并设置新密码。",
    action: "保存新密码",
    failure: "密码重置未完成，请检查验证码后重试。",
  },
}

const requireVerification = "请先完成邮箱验证。需要时可重新发送验证码。"
const loadAuthClient = () => import("./client").then(({ authClient }) => authClient)
const subscribeReady = () => () => {}
const browserReady = () => true
const serverReady = () => false
const initialFlow: AuthFlow = { step: "login", email: "", resendAt: 0 }

function readAuthFlow(value: unknown): AuthFlow | null {
  const flow = value as Partial<AuthFlow> | null
  if (typeof flow?.step !== "string" || !Object.hasOwn(views, flow.step) || typeof flow.email !== "string" || flow.email.length > 254) return null
  if ((flow.step === "verify" || flow.step === "reset") && !flow.email) return null
  const resendAt = typeof flow.resendAt === "number" && Number.isSafeInteger(flow.resendAt) ? flow.resendAt : 0
  return { step: flow.step, email: flow.email, resendAt }
}

function warmPractice() {
  void import("@/features/study/api").then(async ({ readPublic, questionUrl }) => {
    const { topics } = await readPublic<{ topics: { id: string; count: number }[] }>("/api/public/topics")
    const first = topics.find(({ count }) => count > 0)
    if (first) await readPublic(questionUrl({ topic: first.id, offset: 0, limit: 15, practice: true }))
  }).catch(() => {})
}

async function sessionIsVerified() {
  const response = await fetch("/api/me/session", { cache: "no-store" })
  if (!response.ok) throw new Error("session lookup failed")
  const { user } = await response.json()
  return Boolean(user?.id)
}

export function AuthPanel({ destination }: { destination: StudyDestination }) {
  const router = useRouter()
  const ready = useSyncExternalStore(subscribeReady, browserReady, serverReady)
  const [redirecting, navigate] = useTransition()
  const { value, save } = useTabDraft("cqu-auth-flow", readAuthFlow)
  const flow = value ?? initialFlow
  const { step, email, resendAt } = flow
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<FormError | null>(null)
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState<"submit" | "resend" | null>(null)
  const [now, setNow] = useState(Date.now)
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const inFlight = useRef(false)
  const focusAfterTransition = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const view = views[step]
  const hasOtp = step === "verify" || step === "reset"
  const hasPassword = step === "login" || step === "register" || step === "reset"
  const emailError = formError?.field === "email" ? formError.text : undefined
  const otpError = formError?.field === "otp" ? formError.text : undefined
  const passwordError = formError?.field === "password" ? formError.text : undefined
  const passwordDescription = [passwordError && "auth-password-error", step !== "login" && "auth-password-note"]
    .filter(Boolean).join(" ") || undefined

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(1_000, resendAt - now))
    return () => clearTimeout(timer)
  }, [now, remaining, resendAt])

  useEffect(() => {
    if (focusAfterTransition.current) {
      focusAfterTransition.current = false
      heading.current?.focus()
    }
  }, [step])

  function changeStep(next: AuthStep, nextNotice = "", address = email, cooldown = 0) {
    focusAfterTransition.current = next !== step
    const time = Date.now()
    setNow(time)
    save({ step: next, email: address, resendAt: cooldown ? time + cooldown : 0 })
    setPassword("")
    setShowPassword(false)
    setOtp("")
    setFormError(null)
    setNotice(nextNotice)
  }

  function finishSignIn() {
    save(null)
    navigate(() => router.replace(destination))
  }

  function clearFieldError(field: AuthField) {
    const linkedField = step === "login" && field === "email" ? "password" : field
    setFormError((current) => current?.field === field || current?.field === linkedField ? null : current)
  }

  function begin(kind: "submit" | "resend") {
    if (inFlight.current || redirecting) return false
    inFlight.current = true
    setPending(kind)
    setFormError(null)
    setNotice("")
    return true
  }

  function end() {
    inFlight.current = false
    setPending(null)
  }

  function onInvalid(event: FormEvent<HTMLFormElement>) {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    event.preventDefault()
    if (input !== event.currentTarget.querySelector("input:invalid")) return

    const fieldError = authConstraintError(input.name, input.validity)
    if (!fieldError) return
    setFormError(fieldError)
    input.focus()
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!begin("submit")) return

    const fields = new FormData(event.currentTarget)
    const address = String(fields.get("email") ?? email).trim().toLowerCase()
    const submittedPassword = String(fields.get("password") ?? password)
    const submittedOtp = String(fields.get("otp") ?? otp)
    save({ ...flow, email: address })

    try {
      if (destination === "/" && (step === "login" || step === "verify")) warmPractice()
      const authClient = await loadAuthClient()
      switch (step) {
        case "login": {
          const { data, error } = await authClient.signIn.email({ email: address, password: submittedPassword })
          if (error) throw error
          if ((data?.token && data.user?.emailVerified) || await sessionIsVerified()) {
            finishSignIn()
          } else {
            changeStep("verify", requireVerification, address)
          }
          break
        }
        case "register": {
          const { error } = await authClient.signUp.email({
            email: address,
            password: submittedPassword,
            name: "同学",
          })
          if (error) throw error
          changeStep("verify", "已有验证码即可验证。如未收到，请点击重新发送。", address)
          break
        }
        case "verify": {
          const { data, error } = await authClient.emailOtp.verifyEmail({ email: address, otp: submittedOtp })
          if (error) throw error
          if ((data?.token && data.user?.emailVerified) || await sessionIsVerified()) {
            finishSignIn()
          } else {
            changeStep("login", "邮箱已验证，请登录。", address)
          }
          break
        }
        case "forgot": {
          const { error } = await authClient.forgetPassword.emailOtp({ email: address })
          if (error) throw error
          changeStep("reset", "如果该邮箱已注册，请查收密码重置验证码。", address, 60_000)
          break
        }
        case "reset": {
          const { error } = await authClient.emailOtp.resetPassword({
            email: address,
            otp: submittedOtp,
            password: submittedPassword,
          })
          if (error) throw error
          changeStep("login", "密码已更新，请用新密码登录。", address)
          break
        }
      }
    } catch (error) {
      const issue = authIssue(error)
      if (step === "login" && issue?.code === "EMAIL_NOT_VERIFIED") {
        changeStep("verify", requireVerification, address)
      } else {
        const fieldError = issue && authFieldError(step, issue)
        setFormError(fieldError ?? {
          text: issue ? authErrorMessage(issue, view.failure) : "暂时无法完成请求，请检查网络后重试。",
        })
      }
    } finally {
      end()
    }
  }

  async function resend() {
    if (remaining > 0 || !begin("resend")) return

    try {
      const authClient = await loadAuthClient()
      const { error } = step === "verify"
        ? await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
        : await authClient.forgetPassword.emailOtp({ email })
      if (error) throw error
      const time = Date.now()
      setNow(time)
      save({ ...flow, resendAt: time + 60_000 })
      setNotice("如果该邮箱符合发送条件，请查收邮件。")
    } catch (error) {
      const issue = authIssue(error)
      setFormError({
        text: issue ? authErrorMessage(issue, "验证码请求未完成，请稍后重试。") : "暂时无法发送验证码，请检查网络后重试。",
      })
    } finally {
      end()
    }
  }

  return (
    <AuthScreen>
      <header className={styles.heading}>
        <h1 className={styles.brand} ref={step === "login" ? heading : undefined}
          tabIndex={step === "login" ? -1 : undefined}>
          <span className={styles.siteName}><span className={styles.heiti}>入党积极分子</span>练习</span>
        </h1>
        {view.title && <h2 ref={heading} tabIndex={-1}>{view.title}</h2>}
        {view.description && <p>{view.description}</p>}
        {hasOtp && <p className={styles.address}>{email}</p>}
      </header>

      <form method="post" onSubmit={onSubmit} onInvalid={onInvalid}
        onFocus={() => { void loadAuthClient().catch(() => {}) }} className={styles.form}>
        {!hasOtp && (
          <div className={styles.field}>
            <div className={styles.control}>
              <input
                id="auth-email"
                name="email"
                type="email"
                placeholder=" "
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                readOnly={pending !== null}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "auth-email-error" : undefined}
                onChange={(event) => {
                  save({ ...flow, email: event.target.value })
                  clearFieldError("email")
                }}
                maxLength={254}
                required
              />
              <label htmlFor="auth-email">邮箱</label>
            </div>
            {emailError && <p id="auth-email-error" className={styles.fieldError} role="alert">{emailError}</p>}
          </div>
        )}

        {hasOtp && (
          <div className={styles.field}>
            <div className={styles.control}>
              <input
                id="auth-code"
                name="otp"
                className={styles.code}
                placeholder=" "
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                readOnly={pending !== null}
                aria-invalid={otpError ? true : undefined}
                aria-describedby={otpError ? "auth-code-error" : undefined}
                onChange={(event) => {
                  setOtp(event.target.value.replace(/[^0-9]/g, ""))
                  clearFieldError("otp")
                }}
                required
              />
              <label htmlFor="auth-code">验证码</label>
            </div>
            {otpError && <p id="auth-code-error" className={styles.fieldError} role="alert">{otpError}</p>}
          </div>
        )}

        {hasPassword && (
          <div className={styles.field}>
            <div className={`${styles.control} ${styles.password}`}>
              <input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder=" "
                autoComplete={step === "login" ? "current-password" : "new-password"}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordDescription}
                minLength={step === "login" ? undefined : 8}
                maxLength={128}
                value={password}
                readOnly={pending !== null}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError("password")
                }}
                required
              />
              <label htmlFor="auth-password">{step === "reset" ? "新密码" : "密码"}</label>
              <button type="button" className={styles.toggle} aria-controls="auth-password"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword(!showPassword)}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.64-6 10-6 10 6 10 6-3.64 6-10 6S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.5" />
                  {showPassword && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </div>
            {passwordError && <p id="auth-password-error" className={styles.fieldError} role="alert">{passwordError}</p>}
            {step !== "login" && <small id="auth-password-note">至少使用 8 个字符。</small>}
          </div>
        )}

        {formError && !formError.field && <p className={styles.error} role="alert">{formError.text}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <button type="submit" className={styles.submit} disabled={!ready || !!pending || redirecting}>
          {pending === "submit" || redirecting ? "正在处理…" : view.action}
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

      <div className={step === "login" ? `${styles.footer} ${styles.loginFooter}` : styles.footer}>
        {step === "login" ? (
          <>
            <button type="button" className={styles.link} disabled={!!pending}
              onClick={() => changeStep("forgot")}>
              忘记密码
            </button>
            <span className={styles.registerPrompt}>
              <span>第一次使用？</span>
              <button type="button" className={styles.link} disabled={!!pending}
                onClick={() => changeStep("register")}>
                注册
              </button>
            </span>
          </>
        ) : (
          <button type="button" className={styles.link} disabled={!!pending}
            onClick={() => changeStep("login")}>
            返回登录
          </button>
        )}
      </div>
    </AuthScreen>
  )
}

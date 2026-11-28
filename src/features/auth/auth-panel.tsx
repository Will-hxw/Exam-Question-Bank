"use client"

import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { EyeIcon } from "@/components/icons"
import { Button, TextInput } from "@/components/ui"
import { messages } from "@/config/messages"
import { useTabDraft } from "@/use-tab-draft"
import { authConstraintError, authErrorMessage, authFieldError, authIssue, type AuthField, type AuthStep } from "./client-errors"
import type { StudyDestination } from "./study-destination"
import { siteConfig } from "@/config/site"

type FormError = { text: string; field?: AuthField }
type AuthFlow = { step: AuthStep; email: string; resendAt: number }

const views: Record<AuthStep, { title?: string; description?: string; action: string; failure: string }> = messages.auth.steps

const requireVerification = messages.auth.requireVerification
const loadAuthClient = () => import("./client").then(({ authClient }) => authClient)
const subscribeReady = () => () => {}
const browserReady = () => true
const serverReady = () => false
const initialFlow: AuthFlow = { step: "login", email: "", resendAt: 0 }
const neutralFooterLink = "auth-footer-link text-ink-secondary hover:text-ink-primary"

function readAuthFlow(value: unknown): AuthFlow | null {
  const flow = value as Partial<AuthFlow> | null
  if (typeof flow?.step !== "string" || !Object.hasOwn(views, flow.step) || typeof flow.email !== "string" || flow.email.length > 254) return null
  if ((flow.step === "verify" || flow.step === "reset") && !flow.email) return null
  const resendAt = typeof flow.resendAt === "number" && Number.isSafeInteger(flow.resendAt) ? flow.resendAt : 0
  return { step: flow.step, email: flow.email, resendAt }
}

function warmPractice() {
  void import("@/features/study/api").then(async ({ readPublic, questionUrl }) => {
    const { topics } = await readPublic<{ topics: { id: string; count: number }[] }>(siteConfig.api.topics)
    const first = topics.find(({ count }) => count > 0)
    if (first) await readPublic(questionUrl({ topic: first.id, offset: 0, limit: 15, practice: true }))
  }).catch(() => {})
}

async function sessionIsVerified() {
  const response = await fetch(siteConfig.api.session, { cache: "no-store" })
  if (!response.ok) throw new Error("session lookup failed")
  const { user } = await response.json()
  return Boolean(user?.id)
}

export function AuthPanel({ destination }: { destination: StudyDestination }) {
  const router = useRouter()
  const ready = useSyncExternalStore(subscribeReady, browserReady, serverReady)
  const [redirecting, navigate] = useTransition()
  const { value, save } = useTabDraft(siteConfig.storageKeys.authFlow, readAuthFlow)
  const [completed, setCompleted] = useState<AuthFlow | null>(null)
  const flow = completed ?? value ?? initialFlow
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
    const deadline = address.trim().toLowerCase() === email.trim().toLowerCase() ? resendAt : 0
    save({ step: next, email: address, resendAt: cooldown ? time + cooldown : deadline })
    setPassword("")
    setShowPassword(false)
    setOtp("")
    setFormError(null)
    setNotice(nextNotice)
  }

  function finishSignIn(address: string) {
    setCompleted({ ...flow, email: address })
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
    save({ ...flow, email: address, resendAt: address === email.trim().toLowerCase() ? resendAt : 0 })

    try {
      if (destination === siteConfig.routes.practice && (step === "login" || step === "verify")) warmPractice()
      const authClient = await loadAuthClient()
      switch (step) {
        case "login": {
          const { data, error } = await authClient.signIn.email({ email: address, password: submittedPassword })
          if (error) throw error
          if ((data?.token && data.user?.emailVerified) || await sessionIsVerified()) {
            finishSignIn(address)
          } else {
            changeStep("verify", requireVerification, address)
          }
          break
        }
        case "register": {
          const { error } = await authClient.signUp.email({
            email: address,
            password: submittedPassword,
            name: messages.auth.defaultStudentName,
          })
          if (error) throw error
          changeStep("verify", messages.auth.verifyExistingOtpNotice, address)
          break
        }
        case "verify": {
          const { data, error } = await authClient.emailOtp.verifyEmail({ email: address, otp: submittedOtp })
          if (error) throw error
          if ((data?.token && data.user?.emailVerified) || await sessionIsVerified()) {
            finishSignIn(address)
          } else {
            changeStep("login", messages.auth.emailVerifiedNotice, address)
          }
          break
        }
        case "forgot": {
          const { error } = await authClient.forgetPassword.emailOtp({ email: address })
          if (error) throw error
          changeStep("reset", messages.auth.resetOtpSentNotice, address, 60_000)
          break
        }
        case "reset": {
          const { error } = await authClient.emailOtp.resetPassword({
            email: address,
            otp: submittedOtp,
            password: submittedPassword,
          })
          if (error) throw error
          changeStep("login", messages.auth.passwordUpdatedNotice, address)
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
          text: issue ? authErrorMessage(issue, view.failure) : messages.auth.networkError,
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
      save({ ...flow, resendAt: time + siteConfig.timings.resendCooldownMs })
      setNotice(messages.auth.resendSuccessNotice)
    } catch (error) {
      const issue = authIssue(error)
      setFormError({
        text: issue ? authErrorMessage(issue, messages.auth.resendFallbackError) : messages.auth.resendNetworkError,
      })
    } finally {
      end()
    }
  }

  return (
    <div key={step} className="animate-view-enter" data-auth-otp={hasOtp || undefined}>
      <header className="text-center mb-6">
        <h1
          className="font-serif m-0 mb-1.5 text-page-title font-bold text-ink-primary outline-none"
          ref={step === "login" ? heading : undefined}
          tabIndex={step === "login" ? -1 : undefined}
        >
          {siteConfig.subTitle}
        </h1>
        {view.title && <h2 className="font-serif m-0 mt-2 text-base font-semibold text-ink-primary outline-none" ref={heading} tabIndex={-1}>{view.title}</h2>}
        {view.description && <p className="m-0 mt-1.5 text-control text-ink-secondary">{view.description}</p>}
        {hasOtp && <p className="m-0 mt-2 text-sm font-medium text-ink-primary break-all">{email}</p>}
      </header>

      <form
        method="post"
        onSubmit={onSubmit}
        onInvalid={onInvalid}
        onFocus={() => { void loadAuthClient().catch(() => {}) }}
        className="flex flex-col gap-3.5"
      >
        {!hasOtp && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="auth-email" className="text-sm font-medium text-ink-secondary">{messages.auth.emailLabel}</label>
            <TextInput
              id="auth-email"
              name="email"
              type="email"
              placeholder={messages.auth.emailPlaceholder}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              readOnly={pending !== null}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "auth-email-error" : undefined}
              onChange={(event) => {
                const address = event.target.value
                save({ ...flow, email: address, resendAt: address.trim().toLowerCase() === email.trim().toLowerCase() ? resendAt : 0 })
                clearFieldError("email")
              }}
              maxLength={siteConfig.limits.emailMax}
              required
            />
            {emailError && <p id="auth-email-error" className="m-0 text-xs text-wrong-ink" role="alert">{emailError}</p>}
          </div>
        )}

        {hasOtp && (
          <div className="flex flex-col gap-1.5">
            {notice && (
              <p className="m-0 mb-3 px-4 py-3 rounded-control bg-surface text-control leading-relaxed text-ink-secondary" role="status">
                {notice}
              </p>
            )}
            <label htmlFor="auth-code" className="text-sm font-medium text-ink-secondary">{messages.auth.otpLabel}</label>
            <TextInput
              id="auth-code"
              name="otp"
              variant="otp"
              placeholder={messages.auth.otpPlaceholder}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={siteConfig.limits.otpMax}
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
            {otpError && <p id="auth-code-error" className="m-0 text-xs text-wrong-ink" role="alert">{otpError}</p>}
          </div>
        )}

        {hasPassword && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="auth-password" className="text-sm font-medium text-ink-secondary">
              {step === "reset" ? messages.auth.newPasswordLabel : messages.auth.passwordLabel}
            </label>
            <div className="relative">
              <TextInput
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="pr-11"
                placeholder={step === "login" ? messages.auth.loginPasswordPlaceholder : messages.auth.setPasswordPlaceholder}
                autoComplete={step === "login" ? "current-password" : "new-password"}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordDescription}
                minLength={step === "login" ? undefined : siteConfig.limits.passwordMin}
                maxLength={siteConfig.limits.passwordMax}
                value={password}
                readOnly={pending !== null}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError("password")
                }}
                required
              />
              <button
                type="button"
                className={`absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 appearance-none border-0 bg-transparent p-0 flex items-center justify-center ${hasOtp ? "text-ink-secondary" : "text-selected-ink"}`}
                aria-controls="auth-password"
                aria-label={showPassword ? messages.auth.hidePasswordAria : messages.auth.showPasswordAria}
                onClick={() => setShowPassword(!showPassword)}
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
            {passwordError && <p id="auth-password-error" className="m-0 text-xs text-wrong-ink" role="alert">{passwordError}</p>}
            {step !== "login" && <small id="auth-password-note" className="text-xs text-ink-muted">{messages.auth.passwordLengthNote}</small>}
          </div>
        )}

        {formError && !formError.field && <p className="m-0 text-xs text-wrong-ink text-center" role="alert">{formError.text}</p>}
        {!hasOtp && notice && <p className="m-0 text-meta text-ink-secondary text-center" role="status">{notice}</p>}

        <Button type="submit" variant="cta" size="lg" className="w-full mt-1" disabled={!ready || !!pending || redirecting}>
          {pending === "submit" || redirecting ? messages.auth.processing : view.action}
        </Button>
      </form>

      <div className={`mt-5 flex items-center text-meta text-ink-secondary ${step === "login" || hasOtp ? "justify-between" : "justify-center"}`}>
        {step === "login" ? (
          <>
            <button type="button" className={neutralFooterLink} disabled={!!pending}
              onClick={() => changeStep("forgot")}>
              {messages.auth.forgotPassword}
            </button>
            <span className="flex items-center gap-1.5">
              <span>{messages.auth.firstTimePrefix}</span>
              <button type="button" className="auth-footer-link text-selected-ink font-medium" disabled={!!pending}
                onClick={() => changeStep("register")}>
                {messages.auth.registerLink}
              </button>
            </span>
          </>
        ) : (
          <button type="button" className={neutralFooterLink} disabled={!!pending}
            onClick={() => changeStep("login")}>
            {messages.auth.backToLogin}
          </button>
        )}
        {hasOtp && (
          <button
            type="button"
            className={`${neutralFooterLink} disabled:no-underline disabled:hover:text-ink-secondary`}
            disabled={!!pending || remaining > 0}
            onClick={resend}
          >
            {pending === "resend" ? messages.auth.requesting
              : remaining > 0 ? messages.auth.resendCooldown(remaining) : messages.auth.resendOtp}
          </button>
        )}
      </div>
    </div>
  )
}

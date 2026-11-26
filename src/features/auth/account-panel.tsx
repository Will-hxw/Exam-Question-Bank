"use client"

import { useState } from "react"
import { authClient } from "./client"
import { AuthScreen } from "./auth-screen"
import styles from "./auth-panel.module.css"

export function AccountPanel({ email }: { email: string }) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    setPending(true)
    setFailed(false)
    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error("sign-out rejected")
      window.location.replace("/login")
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <AuthScreen>
      <header className={styles.heading}>
        <h1 className={styles.brand}><span className={styles.siteName}>账号</span></h1>
        <p>已验证邮箱</p>
        <p className={styles.address}>{email}</p>
      </header>
      <div className={styles.form}>
        {failed && <p className={styles.error} role="alert">暂时无法退出，请重试。</p>}
        <button type="button" className={styles.submit} disabled={pending} onClick={signOut}>
          {pending ? "正在退出…" : "退出登录"}
        </button>
      </div>
      <p className={styles.footer}>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A fresh document avoids reopening a cached footer fragment. */}
        <a href="/" className={styles.link}>返回练习</a>
      </p>
    </AuthScreen>
  )
}

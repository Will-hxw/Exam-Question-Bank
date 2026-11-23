"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { authClient } from "./client"
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
    <main className={styles.screen}>
      <div className={styles.frame}>
        <div className={styles.brand}>
          <Image src="/brand-mark.png" alt="" width={40} height={40} priority />
          <span>重庆大学入党积极分子练习</span>
        </div>
        <div className={styles.heading}>
          <h1>账号</h1>
          <p>已验证邮箱</p>
          <p className={styles.address}>{email}</p>
        </div>
        <div className={styles.form}>
          {failed && <p className={styles.error} role="alert">暂时无法退出，请重试。</p>}
          <button type="button" className={styles.submit} disabled={pending} onClick={signOut}>
            {pending ? "正在退出…" : "退出登录"}
          </button>
        </div>
        <p className={styles.footer}>
          <Link href="/" className={styles.link}>返回练习</Link>
        </p>
      </div>
    </main>
  )
}

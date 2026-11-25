import Image from "next/image"
import type { ReactNode } from "react"
import styles from "./auth-panel.module.css"

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <div className={styles.wordmark}>
        <Image src="/cqu-wordmark.png" alt="重庆大学" width={194} height={61} preload unoptimized />
      </div>
      <div className={styles.frame}>{children}</div>
      <footer className={styles.credit} lang="en">Hua Xiaowei — ZJU</footer>
    </main>
  )
}

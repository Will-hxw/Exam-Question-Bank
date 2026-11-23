import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"
import nodemailer from "nodemailer"
import type { OtpEvent } from "./neon-webhook"
import { brandImageCid, otpTemplate, practiceSiteName } from "./otp-template"

const smtpAccount = "1176843521@qq.com"
const smtpHost = "smtp.qq.com"
let brandImage: Promise<Buffer | undefined> | undefined

export async function sendOtpMail(event: OtpEvent, smtpAuthorizationCode: string) {
  brandImage ??= readFile(path.join(process.cwd(), "public", "brand-mark.png"))
    .catch(() => undefined)
  const image = await brandImage
  const { subject, text, html } = otpTemplate(event, Boolean(image))
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    auth: { user: smtpAccount, pass: smtpAuthorizationCode },
    tls: { minVersion: "TLSv1.2", servername: smtpHost },
    connectionTimeout: 2_500,
    greetingTimeout: 2_000,
    socketTimeout: 4_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  const result = await transport.sendMail({
    from: { name: practiceSiteName, address: smtpAccount },
    to: { name: "", address: event.email },
    subject,
    text,
    html,
    messageId: `<otp-${event.id}@cqu.xiaoweihua.cn>`,
    attachments: image ? [{
      content: image,
      filename: "practice-brand.png",
      contentType: "image/png",
      cid: brandImageCid,
    }] : [],
  })
  if (result.accepted?.length !== 1 || result.rejected?.length > 0) {
    throw Object.assign(new Error("Unexpected SMTP recipient result"), { code: "EENVELOPE" })
  }
}

export function smtpFailure(error: unknown) {
  const issue = error as {
    code?: string
    command?: string
    responseCode?: number
  } | null
  const response = issue?.responseCode

  if (issue?.code === "EAUTH") return { state: "failed", reason: "smtp_auth" } as const
  if (typeof response === "number" && response >= 400 && response < 500) {
    return { state: "retryable", reason: "smtp_temporary_rejection" } as const
  }
  if (typeof response === "number" && response >= 500 && response < 600) {
    return { state: "failed", reason: "smtp_rejection" } as const
  }
  if (issue?.code === "EDNS" || issue?.command === "CONN" || issue?.command === "EHLO") {
    return { state: "retryable", reason: "smtp_connection" } as const
  }
  return { state: "uncertain", reason: "smtp_unconfirmed" } as const
}

import "server-only"

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import nodemailer, { type SendMailOptions } from "nodemailer"
import type { OtpEvent } from "./neon-webhook"
import { crestContentId, otpTemplate, practiceSiteName } from "./otp-template"

export const smtpAccount = "1176843521@qq.com"
const smtpHost = "smtp.qq.com"

function qqTransport(smtpAuthorizationCode: string, pool = false) {
  return nodemailer.createTransport({
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
    ...(pool ? { pool: true, maxConnections: 1, maxMessages: 3, maxRequeues: 0 } : {}),
  })
}

async function sendFromQq(transport: ReturnType<typeof qqTransport>, message: Omit<SendMailOptions, "from">) {
  const result = await transport.sendMail({
    ...message,
    from: { name: practiceSiteName, address: smtpAccount },
  })
  if (result.accepted?.length !== 1 || result.rejected?.length > 0) {
    throw Object.assign(new Error("Unexpected SMTP recipient result"), { code: "EENVELOPE" })
  }
}

export function sendQqMail(smtpAuthorizationCode: string, message: Omit<SendMailOptions, "from">) {
  return sendFromQq(qqTransport(smtpAuthorizationCode), message)
}

export async function sendOtpMail(event: OtpEvent, smtpAuthorizationCode: string) {
  const crest = await readFile(join(process.cwd(), "public/cqu-crest.png"))
  await sendQqMail(smtpAuthorizationCode, {
    ...otpTemplate(event),
    to: { name: "", address: event.email },
    attachments: [crestAttachment(crest)],
    messageId: `<otp-${event.id}@cqu.xiaoweihua.cn>`,
  })
}

function crestAttachment(crest: Buffer) {
  return { filename: "cqu-crest.png", content: crest, contentType: "image/png", cid: crestContentId }
}

export async function signupFollowupMailer(smtpAuthorizationCode: string) {
  const crest = crestAttachment(await readFile(join(process.cwd(), "public/cqu-crest.png")))
  const transport = qqTransport(smtpAuthorizationCode, true)
  return {
    send: (message: Omit<SendMailOptions, "from" | "attachments">) =>
      sendFromQq(transport, { ...message, attachments: [crest] }),
    close: () => transport.close(),
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

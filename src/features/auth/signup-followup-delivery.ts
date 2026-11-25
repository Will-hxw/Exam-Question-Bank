import "server-only"

import { createHash } from "node:crypto"
import { setTimeout as wait } from "node:timers/promises"
import { query } from "@/server/db"
import { signupFollowupMailer, smtpAccount, smtpFailure } from "./qq-mail"
import { signupFollowupTemplate } from "./signup-followup-template"

type Claim = { user_id: string; email: string; attempts: number }

async function deliverOne(send: Awaited<ReturnType<typeof signupFollowupMailer>>["send"]) {
  const [claim] = await query<Claim>("SELECT * FROM claim_signup_followup()")
  if (!claim) return "idle"

  const recipientKey = createHash("sha256").update(claim.user_id).digest("hex")
  try {
    await send({
      ...signupFollowupTemplate(smtpAccount),
      to: { name: "", address: claim.email },
      replyTo: smtpAccount,
      messageId: `<signup-followup-${recipientKey}@cqu.xiaoweihua.cn>`,
    })
  } catch (error) {
    const { state, reason } = smtpFailure(error)
    const shouldRetry = claim.attempts < 6 && (state === "retryable" || reason === "smtp_auth")
    const nextState = shouldRetry ? "retryable" : state === "retryable" ? "failed" : state
    await query(
      `UPDATE signup_followup_deliveries SET state = $2, failure = $3,
        retry_at = CASE WHEN $2 = 'retryable' THEN statement_timestamp() +
          CASE WHEN $3 = 'smtp_auth' THEN interval '1 hour' ELSE interval '15 minutes' END
          ELSE NULL END,
        updated_at = statement_timestamp()
        WHERE user_id = $1 AND state = 'sending' AND attempts = $4`,
      [claim.user_id, nextState, reason, claim.attempts],
    )
    console.error({ operation: "signup_followup", state: nextState, reason })
    return nextState
  }

  // An interrupted send can have been accepted. Keep pending claims out of the retry pool.
  await query(
    `UPDATE signup_followup_deliveries SET state = 'sent', updated_at = statement_timestamp()
      WHERE user_id = $1 AND state = 'sending' AND attempts = $2`,
    [claim.user_id, claim.attempts],
  )
  return "sent"
}

export async function deliverSignupFollowup(smtpAuthorizationCode: string) {
  const mailer = await signupFollowupMailer(smtpAuthorizationCode)
  let sent = 0
  try {
    while (sent < 3) {
      const result = await deliverOne(mailer.send)
      if (result !== "sent") return { result, sent, more: false }
      sent++
      if (sent < 3) await wait(1_000)
    }
    return { result: "sent" as const, sent, more: true }
  } finally {
    mailer.close()
  }
}

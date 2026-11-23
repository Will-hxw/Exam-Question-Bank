import "server-only"

import { query } from "@/server/db"
import type { OtpEvent } from "./neon-webhook"
import { sendOtpMail, smtpFailure } from "./qq-mail"

type DeliveryState = "sending" | "sent" | "retryable" | "failed" | "uncertain"

export async function deliverOtp(event: OtpEvent, smtpAuthorizationCode: string) {
  const [claimed] = await query<{ event_id: string }>(
    `INSERT INTO auth_otp_deliveries (event_id, state, attempts, expires_at)
      VALUES ($1, 'sending', 1, $2)
      ON CONFLICT (event_id) DO UPDATE SET
        state = 'sending', attempts = auth_otp_deliveries.attempts + 1,
        failure = NULL, updated_at = statement_timestamp()
      WHERE auth_otp_deliveries.state = 'retryable'
        AND auth_otp_deliveries.attempts < 3
        AND auth_otp_deliveries.expires_at > statement_timestamp()
      RETURNING event_id`,
    [event.id, new Date(event.expiresAt).toISOString()],
  )

  if (!claimed) {
    const [existing] = await query<{ state: DeliveryState }>(
      "SELECT state FROM auth_otp_deliveries WHERE event_id = $1",
      [event.id],
    )
    return existing?.state === "sent"
  }

  try {
    await sendOtpMail(event, smtpAuthorizationCode)
  } catch (error) {
    const { state, reason } = smtpFailure(error)
    await query(
      `UPDATE auth_otp_deliveries
        SET state = $2, failure = $3, updated_at = statement_timestamp()
        WHERE event_id = $1 AND state = 'sending'`,
      [event.id, state, reason],
    )
    return false
  }

  const [delivered] = await query<{ event_id: string }>(
    `UPDATE auth_otp_deliveries
      SET state = 'sent', updated_at = statement_timestamp()
      WHERE event_id = $1 AND state = 'sending'
      RETURNING event_id`,
    [event.id],
  )
  return Boolean(delivered)
}

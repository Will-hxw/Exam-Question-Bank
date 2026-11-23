import "server-only"

import { createHmac } from "node:crypto"
import { isIP } from "node:net"
import { query } from "@/server/db"
import type { AuthPost } from "./request"

const windowSeconds = 15 * 60

function limitsFor(path: AuthPost) {
  switch (path) {
    case "sign-in/email":
      return { scope: "password", account: 12, network: 400 }
    case "email-otp/verify-email":
    case "email-otp/reset-password":
      return { scope: "code", account: 12, network: 240 }
    default:
      return { scope: "send", account: 4, network: 120 }
  }
}

export async function authRetryAfter(request: Request, path: AuthPost, email: string) {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (!secret) throw new Error("Auth rate limit hash key is not configured")

  const limits = limitsFor(path)
  const edgeClient = request.headers.get("eo-connecting-ip")?.trim() ?? ""
  const client = isIP(edgeClient) ? edgeClient : "unattributed"
  const hash = (kind: "account" | "network", value: string) =>
    createHmac("sha256", secret).update(`auth:${limits.scope}:${kind}:${value}`).digest("hex")

  const keys = [hash("account", email), hash("network", client)]
  const quotas = [limits.account, limits.network]
  const [result] = await query<{ retry_after: number }>(
    `WITH quotas AS (
      SELECT * FROM unnest($1::text[], $2::integer[]) AS input(bucket, max_hits)
    ), increments AS (
      INSERT INTO auth_rate_limits (bucket, hits, expires_at)
      SELECT bucket, 1, statement_timestamp() + make_interval(secs => $3) FROM quotas
      ORDER BY bucket
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE
          WHEN auth_rate_limits.expires_at <= statement_timestamp() THEN 1
          ELSE LEAST(auth_rate_limits.hits, 10000) + 1
        END,
        expires_at = CASE
          WHEN auth_rate_limits.expires_at <= statement_timestamp() THEN EXCLUDED.expires_at
          ELSE auth_rate_limits.expires_at
        END
      RETURNING bucket, hits, expires_at
    )
    SELECT COALESCE(MAX(ceil(EXTRACT(EPOCH FROM expires_at - statement_timestamp()))), 0)::integer AS retry_after
    FROM increments JOIN quotas USING (bucket)
    WHERE hits > max_hits`,
    [keys, quotas, windowSeconds],
  )

  return result.retry_after
}

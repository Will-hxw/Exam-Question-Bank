import { createPublicKey, verify, type KeyObject } from "node:crypto"
import { normalizeEmail } from "./request.ts"

const allowedAge = 5 * 60 * 1_000
const allowedClockSkew = 30 * 1_000
const eventIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const tokenPattern = /^[A-Za-z0-9_-]+$/

export type OtpPurpose = "email-verification" | "forget-password"
export type OtpEvent = {
  id: string
  email: string
  code: string
  purpose: OtpPurpose
  expiresAt: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function json(value: Uint8Array) {
  try {
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)))
  } catch {
    return null
  }
}

export async function verifyOtpEvent(
  body: Uint8Array,
  headers: Headers,
  endpointId: string,
  keyFor: (id: string) => Promise<KeyObject | undefined>,
  now = Date.now(),
): Promise<OtpEvent | null> {
  const kid = headers.get("x-neon-signature-kid") ?? ""
  const signedTimestamp = headers.get("x-neon-timestamp") ?? ""
  const receivedId = headers.get("x-neon-event-id") ?? ""
  const detached = headers.get("x-neon-signature") ?? ""

  if (!/^\d{13}$/.test(signedTimestamp)
    || !eventIdPattern.test(receivedId)
    || !tokenPattern.test(kid)
    || kid.length > 100
    || headers.get("x-neon-event-type") !== "send.otp"
    || detached.length > 1_024) return null

  const signedAt = Number(signedTimestamp)
  if (signedAt < now - allowedAge || signedAt > now + allowedClockSkew) return null

  const parts = detached.split(".")
  if (parts.length !== 3 || parts[1] !== ""
    || !tokenPattern.test(parts[0])
    || !tokenPattern.test(parts[2])) return null

  const [protectedHeader, , signature] = parts
  const jws = json(Buffer.from(protectedHeader, "base64url"))
  const signatureBytes = Buffer.from(signature, "base64url")
  if (jws?.alg !== "EdDSA" || jws.kid !== kid
    || "crit" in jws || "b64" in jws
    || signatureBytes.length !== 64
    || signatureBytes.toString("base64url") !== signature) return null

  const publicKey = await keyFor(kid)
  if (publicKey?.asymmetricKeyType !== "ed25519") return null

  const encodedBody = Buffer.from(body).toString("base64url")
  const encodedBoundBody = Buffer.from(`${signedTimestamp}.${encodedBody}`).toString("base64url")
  const input = Buffer.from(`${protectedHeader}.${encodedBoundBody}`)
  if (!verify(null, input, publicKey, signatureBytes)) return null

  const event = json(body)
  const details = record(event?.event_data)
  const eventAt = typeof event?.timestamp === "string" ? Date.parse(event.timestamp) : NaN
  const expiresAt = typeof details?.expires_at === "string" ? Date.parse(details.expires_at) : NaN
  const email = normalizeEmail(record(event?.user)?.email)
  const purpose = details?.otp_type
  const code = details?.otp_code
  const delivery = details?.delivery_preference
  if (event?.event_id !== receivedId
    || event.event_type !== "send.otp"
    || record(event.context)?.endpoint_id !== endpointId
    || !Number.isFinite(eventAt)
    || eventAt < now - allowedAge
    || eventAt > now + allowedClockSkew
    || !Number.isFinite(expiresAt)
    || expiresAt <= now
    || !email
    || (delivery !== undefined && delivery !== "email")
    || (purpose !== "email-verification" && purpose !== "forget-password")
    || typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return null

  return { id: receivedId.toLowerCase(), email, code, purpose, expiresAt }
}

function parseJwks(value: unknown) {
  const result = new Map<string, KeyObject>()
  const keys = record(value)?.keys
  if (!Array.isArray(keys)) return result

  for (const candidate of keys) {
    const key = record(candidate)
    if (key?.kty !== "OKP" || key.crv !== "Ed25519"
      || typeof key.kid !== "string" || typeof key.x !== "string"
      || "d" in key
      || (key.alg !== undefined && key.alg !== "EdDSA")
      || (key.use !== undefined && key.use !== "sig")) continue

    try {
      const publicKey = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: key.x },
        format: "jwk",
      })
      result.set(key.kid, publicKey)
    } catch {
      continue
    }
  }
  return result
}

const cacheFor = 5 * 60 * 1_000
const minRefreshInterval = 30 * 1_000

export function neonSigningKeys(baseUrl: string) {
  const url = new URL(baseUrl.replace(/\/$/, "") + "/.well-known/jwks.json")
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Invalid Neon JWKS location")
  }

  let keys = new Map<string, KeyObject>()
  let validUntil = 0
  let nextRefresh = 0
  let inFlight: Promise<void> | undefined

  return async function signingKey(kid: string) {
    const now = Date.now()
    if (now < validUntil && keys.has(kid)) return keys.get(kid)

    if (!inFlight && now >= nextRefresh) {
      nextRefresh = now + minRefreshInterval
      inFlight = (async () => {
        const response = await fetch(url, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(2_500),
        })
        if (!response.ok) throw new Error("Neon signing keys unavailable")
        const newKeys = parseJwks(await response.json())
        if (newKeys.size === 0) throw new Error("Neon signing keys unavailable")
        keys = newKeys
        validUntil = Date.now() + cacheFor
      })().finally(() => { inFlight = undefined })
    }

    await inFlight
    if (Date.now() >= validUntil) throw new Error("Neon signing keys unavailable")
    return keys.get(kid)
  }
}

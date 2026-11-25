import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose"
import { signupFollowupPath, signupFollowupSite } from "./signup-followup-template.ts"

const issuer = "https://token.actions.githubusercontent.com"
const repositoryId = "1266193307"
const workflow = "Will-hxw/Exam-Question-Bank/.github/workflows/signup-followup.yml@refs/heads/main"
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), { timeoutDuration: 2_500 })

export async function isSignupFollowupRunner(header: string | null, keyFor: JWTVerifyGetKey = keys) {
  if (!header?.startsWith("Bearer ") || header.length > 8_192) return false
  try {
    const { payload } = await jwtVerify(header.slice(7), keyFor, {
      issuer,
      audience: signupFollowupSite + signupFollowupPath,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "repository_id", "workflow_ref", "event_name"],
      maxTokenAge: "5 minutes",
      clockTolerance: 15,
    })
    return payload.repository_id === repositoryId && payload.workflow_ref === workflow
      && (payload.event_name === "schedule" || payload.event_name === "workflow_dispatch")
  } catch {
    return false
  }
}

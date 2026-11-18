import { importPKCS8, SignJWT } from 'jose'
import { env } from '@/lib/core/config/env'

/** Who the memory sidecar accepts an attestation from, and for. */
const ISSUER = 'sim'
const AUDIENCE = 'mothership-memory'
/** Long enough for one memory call (the worker allows 30 seconds) and one retry. */
const TTL_SECONDS = 60

export interface MemoryScopeClaims {
  userId: string
  chatId: string
  organizationId: string | null
  workspaceId: string | null
  spaceId: string | null
}

/**
 * Signs the scope Sim just authorized, so the memory sidecar can verify who a request acts for
 * without trusting the worker that forwards it: an EdDSA JWT over the canonical ids, valid for
 * one minute. `null` when this deployment has no signing key.
 */
export async function signMemoryScope(claims: MemoryScopeClaims): Promise<string | null> {
  const pem = env.MOTHERSHIP_MEMORY_SIGNING_KEY
  if (!pem) return null
  return new SignJWT({
    chat: claims.chatId,
    org: claims.organizationId,
    ws: claims.workspaceId,
    space: claims.spaceId,
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(await importPKCS8(pem.replace(/\\n/g, '\n'), 'EdDSA'))
}

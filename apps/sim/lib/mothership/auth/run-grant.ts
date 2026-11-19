import { createHmac, hkdfSync } from 'node:crypto'
import { errors, jwtVerify } from 'jose'
import { env } from '@/lib/core/config/env'
import { RUN_GRANT_HEADER } from '@/lib/mothership/generated/sim-transport'

/**
 * Run grants: Sim's signature over the user, chat and owner of a Mothership turn, sent with every
 * leg it starts. The worker returns the chat's grant on each call it makes back to Sim, so those
 * calls act only for an identity Sim handed it, not for whichever user the worker names.
 *
 * The key is derived from Sim's own auth secret, which the worker never holds, under a label used
 * for nothing else, so Sim alone can issue or check a grant.
 */
const ISSUER = 'sim'
const AUDIENCE = 'sim:mothership-run-grant'
const KEY_LABEL = 'sim/mothership-run-grant/v1'
/** Longer than any gap between a run's calls to Sim; a run-control answer renews it past half. */
const RUN_GRANT_TTL_SECONDS = 24 * 60 * 60

export interface RunGrantIdentity {
  userId: string
  /** Absent when the turn had no chat; the grant then binds the user and owner only. */
  chatId?: string
  workspaceId: string | null
  organizationId: string | null
}

export type RunGrantCheck =
  | { ok: true; issuedAt: number; identity: RunGrantIdentity }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'mismatch' }

function grantKey(): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', env.BETTER_AUTH_SECRET, new Uint8Array(0), KEY_LABEL, 32)
  )
}

/**
 * A compact HS256 JWT, signed synchronously: issuing runs on every leg Sim sends, so it adds no
 * await to the dispatch path. `checkRunGrant` verifies it as any JWT.
 */
export function issueRunGrant(identity: RunGrantIdentity): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: identity.userId,
    iat: issuedAt,
    exp: issuedAt + RUN_GRANT_TTL_SECONDS,
    ...(identity.chatId ? { chat: identity.chatId } : {}),
    ws: identity.workspaceId,
    org: identity.organizationId,
  })}`
  return `${unsigned}.${createHmac('sha256', grantKey()).update(unsigned).digest('base64url')}`
}

/** The header carrying a turn's grant, for a leg Sim sends: none for a turn with no single owner. */
export function runGrantHeaders(context: {
  userId: string
  chatId?: string
  workspaceId?: string
  organizationId?: string
}): Record<string, string> {
  if (Boolean(context.workspaceId) === Boolean(context.organizationId)) return {}
  return {
    [RUN_GRANT_HEADER]: issueRunGrant({
      userId: context.userId,
      ...(context.chatId ? { chatId: context.chatId } : {}),
      workspaceId: context.workspaceId ?? null,
      organizationId: context.organizationId ?? null,
    }),
  }
}

/** Whether `token` is a grant Sim issued for exactly the identity a worker call names. */
export async function checkRunGrant(
  token: string | null | undefined,
  claimed: { userId: string; chatId?: string; workspaceId?: string; organizationId?: string }
): Promise<RunGrantCheck> {
  if (!token) return { ok: false, reason: 'missing' }
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    ;({ payload } = await jwtVerify(token, grantKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'iat', 'exp'],
    }))
  } catch (error) {
    return { ok: false, reason: error instanceof errors.JWTExpired ? 'expired' : 'invalid' }
  }
  const identity: RunGrantIdentity = {
    userId: String(payload.sub),
    ...(typeof payload.chat === 'string' ? { chatId: payload.chat } : {}),
    workspaceId: typeof payload.ws === 'string' ? payload.ws : null,
    organizationId: typeof payload.org === 'string' ? payload.org : null,
  }
  if (
    identity.userId !== claimed.userId ||
    identity.workspaceId !== (claimed.workspaceId ?? null) ||
    identity.organizationId !== (claimed.organizationId ?? null) ||
    (identity.chatId !== undefined && identity.chatId !== claimed.chatId)
  )
    return { ok: false, reason: 'mismatch' }
  return { ok: true, issuedAt: Number(payload.iat), identity }
}

/**
 * Whether a worker call may go on. A forged or mismatched grant never; a valid one always; a
 * missing or expired one only until `MOTHERSHIP_REQUIRE_RUN_GRANT`, so workers that predate
 * grants, and runs that outlived theirs, keep working while grants roll out.
 */
export function acceptsRunGrant(check: RunGrantCheck): boolean {
  if (check.ok) return true
  if (check.reason === 'invalid' || check.reason === 'mismatch') return false
  return !env.MOTHERSHIP_REQUIRE_RUN_GRANT
}

/** The grant each worker principal was admitted on, keyed by the principal object itself. */
const admittedGrants = new WeakMap<object, Extract<RunGrantCheck, { ok: true }>>()

export function rememberRunGrant(principal: object, check: RunGrantCheck): void {
  if (check.ok) admittedGrants.set(principal, check)
}

/**
 * A fresh grant for the same identity, once the one this call carried is past half its life.
 * Only a grant Sim verified is renewed, so renewal never grants an identity Sim had not. The
 * caller sends it only after rechecking the user's access.
 */
export function renewedRunGrant(principal: object): string | undefined {
  const admitted = admittedGrants.get(principal)
  if (!admitted || Date.now() / 1000 - admitted.issuedAt < RUN_GRANT_TTL_SECONDS / 2)
    return undefined
  return issueRunGrant(admitted.identity)
}

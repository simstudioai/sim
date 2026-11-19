import { createHmac, hkdfSync } from 'node:crypto'
import { errors, jwtVerify } from 'jose'
import { env, isTruthy } from '@/lib/core/config/env'
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

/** Who a grant names: the user, the chat (when the turn had one) and its single owner. */
export interface RunGrantIdentity {
  userId: string
  /** Absent when the turn had no chat; such a grant admits only calls that name no chat. */
  chatId?: string
  workspaceId: string | null
  organizationId: string | null
}

/** The outcome of checking a call's grant: the verified grant, or why there is none. */
export type RunGrantCheck =
  | { ok: true; issuedAt: number; identity: RunGrantIdentity }
  | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'mismatch' }

/**
 * The grant key, or undefined where Sim runs without an auth secret (`DISABLE_AUTH`): such a
 * deployment issues no grants and serves worker calls only while grants are not required.
 */
function grantKey(): Uint8Array | undefined {
  if (!env.BETTER_AUTH_SECRET) return undefined
  return new Uint8Array(
    hkdfSync('sha256', env.BETTER_AUTH_SECRET, new Uint8Array(0), KEY_LABEL, 32)
  )
}

function signRunGrant(identity: RunGrantIdentity, key: Uint8Array): string {
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
  return `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`
}

/**
 * A grant for `identity`: a compact HS256 JWT, signed synchronously, so issuing one on every leg
 * Sim sends adds no await to the dispatch path; `checkRunGrant` verifies it as any JWT. Throws
 * where Sim has no auth secret, where `runGrantHeaders` issues none.
 */
export function issueRunGrant(identity: RunGrantIdentity): string {
  const key = grantKey()
  if (!key) throw new Error('Run grants need BETTER_AUTH_SECRET')
  return signRunGrant(identity, key)
}

/**
 * The header carrying a turn's grant, for a leg Sim sends: none for a turn with no single owner,
 * or where Sim has no auth secret to sign with.
 */
export function runGrantHeaders(context: {
  userId: string
  chatId?: string
  workspaceId?: string
  organizationId?: string
}): Record<string, string> {
  const key = grantKey()
  if (!key || Boolean(context.workspaceId) === Boolean(context.organizationId)) return {}
  return {
    [RUN_GRANT_HEADER]: signRunGrant(
      {
        userId: context.userId,
        ...(context.chatId ? { chatId: context.chatId } : {}),
        workspaceId: context.workspaceId ?? null,
        organizationId: context.organizationId ?? null,
      },
      key
    ),
  }
}

/**
 * Whether `token` is a grant Sim issued for exactly the identity a worker call names: the same
 * user, owner and chat, where a grant with no chat matches only a call that names none.
 */
export async function checkRunGrant(
  token: string | null | undefined,
  claimed: { userId: string; chatId?: string; workspaceId?: string; organizationId?: string }
): Promise<RunGrantCheck> {
  const key = grantKey()
  if (!token || !key) return { ok: false, reason: 'missing' }
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    ;({ payload } = await jwtVerify(token, key, {
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
    identity.chatId !== claimed.chatId
  )
    return { ok: false, reason: 'mismatch' }
  return { ok: true, issuedAt: Number(payload.iat), identity }
}

/**
 * Whether a worker call may go on. A forged or mismatched grant never; a valid one always; a
 * missing or expired one only until `MOTHERSHIP_REQUIRE_RUN_GRANT` is true, so workers that
 * predate grants, and runs that outlived theirs, keep working while grants roll out.
 */
export function acceptsRunGrant(check: RunGrantCheck): boolean {
  if (check.ok) return true
  if (check.reason === 'invalid' || check.reason === 'mismatch') return false
  return !isTruthy(env.MOTHERSHIP_REQUIRE_RUN_GRANT)
}

/** The grant each worker principal was admitted on, keyed by the principal object itself. */
const admittedGrants = new WeakMap<object, Extract<RunGrantCheck, { ok: true }>>()

/**
 * Records the grant a worker principal was admitted on, so the same principal object can later
 * be renewed (`renewedRunGrant`). Only a verified grant is kept; any other check records nothing.
 */
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
  const key = grantKey()
  if (!admitted || !key || Date.now() / 1000 - admitted.issuedAt < RUN_GRANT_TTL_SECONDS / 2)
    return undefined
  return signRunGrant(admitted.identity, key)
}

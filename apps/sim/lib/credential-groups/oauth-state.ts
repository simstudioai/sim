import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { getRedisClient } from '@/lib/core/config/redis'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  type CredentialGroupProvider,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000
const OAUTH_ATTEMPT_VERSION = 2 as const
const OAUTH_ATTEMPT_STATE_PREFIX = 'cg_'

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return nil
end
redis.call('DEL', KEYS[1])
return value
`

interface StoredCredentialGroupOAuthAttempt {
  version: typeof OAUTH_ATTEMPT_VERSION
  provider: CredentialGroupProvider
  enrollmentId: string
  credentialGroupId: string
  optionId: string
  authorizationAppId: string
  scopeVersion: number
  requiredScopes: string[]
  redirectUri: string
  nonceHash: string
  encryptedCodeVerifier?: string
  encryptedInvitationToken: string
  createdAt: number
}

export interface CredentialGroupOAuthAttempt {
  state: string
  provider: CredentialGroupProvider
  nonceHash: string
  enrollmentId: string
  credentialGroupId: string
  optionId: string
  authorizationAppId: string
  scopeVersion: number
  requiredScopes: string[]
  redirectUri: string
  codeVerifier?: string
  invitationToken: string
  createdAt: number
}

interface CreateCredentialGroupOAuthAttemptParams {
  provider: CredentialGroupProvider
  enrollmentId: string
  credentialGroupId: string
  optionId: string
  authorizationAppId: string
  scopeVersion: number
  requiredScopes: string[]
  redirectUri: string
  codeVerifier?: string
  invitationToken: string
}

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Credential group OAuth requires Redis')
  }
  return redis
}

function attemptKey(state: string): string {
  return `credential-group:oauth-attempt:${sha256Hex(state)}`
}

function isStoredAttempt(value: unknown): value is StoredCredentialGroupOAuthAttempt {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === OAUTH_ATTEMPT_VERSION &&
    typeof candidate.provider === 'string' &&
    isCredentialGroupProvider(candidate.provider) &&
    typeof candidate.enrollmentId === 'string' &&
    typeof candidate.credentialGroupId === 'string' &&
    typeof candidate.optionId === 'string' &&
    typeof candidate.authorizationAppId === 'string' &&
    typeof candidate.scopeVersion === 'number' &&
    Number.isInteger(candidate.scopeVersion) &&
    candidate.scopeVersion > 0 &&
    Array.isArray(candidate.requiredScopes) &&
    candidate.requiredScopes.length > 0 &&
    candidate.requiredScopes.every((scope) => typeof scope === 'string' && scope.length > 0) &&
    typeof candidate.redirectUri === 'string' &&
    typeof candidate.nonceHash === 'string' &&
    (candidate.encryptedCodeVerifier === undefined ||
      typeof candidate.encryptedCodeVerifier === 'string') &&
    typeof candidate.encryptedInvitationToken === 'string' &&
    typeof candidate.createdAt === 'number'
  )
}

/** Creates a short-lived, one-time OAuth attempt. Only state and nonce leave the server. */
export async function createCredentialGroupOAuthAttempt(
  params: CreateCredentialGroupOAuthAttemptParams
): Promise<{ state: string; nonce: string }> {
  const redis = requireRedis()
  const state = `${OAUTH_ATTEMPT_STATE_PREFIX}${generateId()}`
  const nonce = generateId()
  const [encryptedCodeVerifier, encryptedInvitationToken] = await Promise.all([
    params.codeVerifier ? encryptSecret(params.codeVerifier) : undefined,
    encryptSecret(params.invitationToken),
  ])
  const attempt: StoredCredentialGroupOAuthAttempt = {
    version: OAUTH_ATTEMPT_VERSION,
    provider: params.provider,
    enrollmentId: params.enrollmentId,
    credentialGroupId: params.credentialGroupId,
    optionId: params.optionId,
    authorizationAppId: params.authorizationAppId,
    scopeVersion: params.scopeVersion,
    requiredScopes: params.requiredScopes,
    redirectUri: params.redirectUri,
    nonceHash: sha256Hex(nonce),
    ...(encryptedCodeVerifier ? { encryptedCodeVerifier: encryptedCodeVerifier.encrypted } : {}),
    encryptedInvitationToken: encryptedInvitationToken.encrypted,
    createdAt: Date.now(),
  }
  const stored = await redis.set(
    attemptKey(state),
    JSON.stringify(attempt),
    'PX',
    OAUTH_ATTEMPT_TTL_MS,
    'NX'
  )
  if (stored !== 'OK') throw new Error('Credential group OAuth state collision')
  return { state, nonce }
}

/** Identifies managed-enrollment callbacks before touching one-time Redis state. */
export function isCredentialGroupOAuthState(state: string): boolean {
  return state.startsWith(OAUTH_ATTEMPT_STATE_PREFIX)
}

/** Atomically burns state before the single-use authorization code is exchanged. */
export async function consumeCredentialGroupOAuthAttempt(
  state: string
): Promise<CredentialGroupOAuthAttempt | null> {
  const redis = requireRedis()
  const raw = await redis.eval(CONSUME_SCRIPT, 1, attemptKey(state))
  if (raw === null) return null
  if (typeof raw !== 'string') throw new Error('Credential group OAuth state is malformed')

  const parsed: unknown = JSON.parse(raw)
  if (!isStoredAttempt(parsed)) throw new Error('Credential group OAuth state is malformed')
  if (Date.now() - parsed.createdAt > OAUTH_ATTEMPT_TTL_MS) return null

  const [codeVerifier, invitationToken] = await Promise.all([
    parsed.encryptedCodeVerifier ? decryptSecret(parsed.encryptedCodeVerifier) : undefined,
    decryptSecret(parsed.encryptedInvitationToken),
  ])
  return {
    state,
    provider: parsed.provider,
    nonceHash: parsed.nonceHash,
    enrollmentId: parsed.enrollmentId,
    credentialGroupId: parsed.credentialGroupId,
    optionId: parsed.optionId,
    authorizationAppId: parsed.authorizationAppId,
    scopeVersion: parsed.scopeVersion,
    requiredScopes: parsed.requiredScopes,
    redirectUri: parsed.redirectUri,
    ...(codeVerifier ? { codeVerifier: codeVerifier.decrypted } : {}),
    invitationToken: invitationToken.decrypted,
    createdAt: parsed.createdAt,
  }
}

/** Compares a verified ID-token nonce with the hash retained in the OAuth attempt. */
export function credentialGroupOAuthNonceMatches(nonce: string, storedNonceHash: string): boolean {
  return safeCompare(sha256Hex(nonce), storedNonceHash)
}

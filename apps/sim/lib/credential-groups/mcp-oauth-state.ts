import { sha256Hex } from '@sim/security/hash'
import { getRedisClient } from '@/lib/core/config/redis'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { assertCredentialGroupOAuthAttemptVersion } from '@/lib/credential-groups/oauth-attempt-version'

const MCP_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000
const MCP_OAUTH_ATTEMPT_VERSION = 3 as const
const MCP_OAUTH_STATE_PREFIX = 'mcp_cg_'

const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return nil
end
redis.call('DEL', KEYS[1])
return value
`

const CLEAR_SERVER_ATTEMPTS_SCRIPT = `
local keys = redis.call('SMEMBERS', KEYS[1])
for _, key in ipairs(keys) do
  redis.call('DEL', key)
end
redis.call('DEL', KEYS[1])
return #keys
`

interface StoredCredentialGroupMcpOAuthAttempt {
  oauthConfigVersion: number
  userId: string
  version: typeof MCP_OAUTH_ATTEMPT_VERSION
  workspaceId?: string
  organizationId?: string
  email: string
  enrollmentId: string
  credentialGroupId: string
  mcpServerId: string
  encryptedCodeVerifier: string
  encryptedInvitationToken: string
  createdAt: number
}

export interface CredentialGroupMcpOAuthAttempt {
  oauthConfigVersion: number
  userId: string
  state: string
  workspaceId?: string
  organizationId?: string
  email: string
  enrollmentId: string
  credentialGroupId: string
  mcpServerId: string
  codeVerifier: string
  invitationToken: string
  createdAt: number
}

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('Credential Group MCP OAuth requires Redis')
  return redis
}

function attemptKey(state: string): string {
  return `credential-group:mcp-oauth-attempt:${sha256Hex(state)}`
}

function serverAttemptsKey(mcpServerId: string): string {
  return `credential-group:mcp-oauth-attempts:${mcpServerId}`
}

function isStoredAttempt(value: unknown): value is StoredCredentialGroupMcpOAuthAttempt {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === MCP_OAUTH_ATTEMPT_VERSION &&
    typeof candidate.oauthConfigVersion === 'number' &&
    Number.isInteger(candidate.oauthConfigVersion) &&
    candidate.oauthConfigVersion > 0 &&
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0 &&
    ((typeof candidate.workspaceId === 'string' &&
      candidate.workspaceId.length > 0 &&
      candidate.organizationId === undefined) ||
      (typeof candidate.organizationId === 'string' &&
        candidate.organizationId.length > 0 &&
        candidate.workspaceId === undefined)) &&
    typeof candidate.email === 'string' &&
    candidate.email.length >= 3 &&
    candidate.email.length <= 320 &&
    typeof candidate.enrollmentId === 'string' &&
    typeof candidate.credentialGroupId === 'string' &&
    typeof candidate.mcpServerId === 'string' &&
    typeof candidate.encryptedCodeVerifier === 'string' &&
    typeof candidate.encryptedInvitationToken === 'string' &&
    typeof candidate.createdAt === 'number'
  )
}

export function isCredentialGroupMcpOAuthState(state: string): boolean {
  return state.startsWith(MCP_OAUTH_STATE_PREFIX)
}

export async function createCredentialGroupMcpOAuthAttempt(params: {
  oauthConfigVersion: number
  userId: string
  state: string
  workspaceId?: string
  organizationId?: string
  email: string
  enrollmentId: string
  credentialGroupId: string
  mcpServerId: string
  codeVerifier: string
  invitationToken: string
}): Promise<void> {
  if (!isCredentialGroupMcpOAuthState(params.state)) {
    throw new Error('Managed MCP OAuth state has an invalid prefix')
  }
  const redis = requireRedis()
  const [codeVerifier, invitationToken] = await Promise.all([
    encryptSecret(params.codeVerifier),
    encryptSecret(params.invitationToken),
  ])
  const attempt: StoredCredentialGroupMcpOAuthAttempt = {
    version: MCP_OAUTH_ATTEMPT_VERSION,
    oauthConfigVersion: params.oauthConfigVersion,
    userId: params.userId,
    ...resourceScopeFields(resourceScopeFromOwner(params)),
    email: params.email,
    enrollmentId: params.enrollmentId,
    credentialGroupId: params.credentialGroupId,
    mcpServerId: params.mcpServerId,
    encryptedCodeVerifier: codeVerifier.encrypted,
    encryptedInvitationToken: invitationToken.encrypted,
    createdAt: Date.now(),
  }
  const stored = await redis.set(
    attemptKey(params.state),
    JSON.stringify(attempt),
    'PX',
    MCP_OAUTH_ATTEMPT_TTL_MS,
    'NX'
  )
  if (stored !== 'OK') throw new Error('Credential Group MCP OAuth state collision')
  await redis.sadd(serverAttemptsKey(params.mcpServerId), attemptKey(params.state))
  await redis.pexpire(serverAttemptsKey(params.mcpServerId), MCP_OAUTH_ATTEMPT_TTL_MS)
}

export async function consumeCredentialGroupMcpOAuthAttempt(
  state: string
): Promise<CredentialGroupMcpOAuthAttempt | null> {
  if (!isCredentialGroupMcpOAuthState(state)) return null
  const raw = await requireRedis().eval(CONSUME_SCRIPT, 1, attemptKey(state))
  if (raw === null) return null
  if (typeof raw !== 'string') throw new Error('Credential Group MCP OAuth state is malformed')
  const parsed: unknown = JSON.parse(raw)
  assertCredentialGroupOAuthAttemptVersion(parsed, MCP_OAUTH_ATTEMPT_VERSION)
  if (!isStoredAttempt(parsed)) throw new Error('Credential Group MCP OAuth state is malformed')
  await requireRedis().srem(serverAttemptsKey(parsed.mcpServerId), attemptKey(state))
  if (Date.now() - parsed.createdAt > MCP_OAUTH_ATTEMPT_TTL_MS) return null
  const [codeVerifier, invitationToken] = await Promise.all([
    decryptSecret(parsed.encryptedCodeVerifier),
    decryptSecret(parsed.encryptedInvitationToken),
  ])
  return {
    state,
    oauthConfigVersion: parsed.oauthConfigVersion,
    userId: parsed.userId,
    ...resourceScopeFields(resourceScopeFromOwner(parsed)),
    email: parsed.email,
    enrollmentId: parsed.enrollmentId,
    credentialGroupId: parsed.credentialGroupId,
    mcpServerId: parsed.mcpServerId,
    codeVerifier: codeVerifier.decrypted,
    invitationToken: invitationToken.decrypted,
    createdAt: parsed.createdAt,
  }
}

export async function clearCredentialGroupMcpOAuthAttempts(mcpServerIds: string[]): Promise<void> {
  if (mcpServerIds.length === 0) return
  const redis = requireRedis()
  await Promise.all(
    mcpServerIds.map((mcpServerId) =>
      redis.eval(CLEAR_SERVER_ATTEMPTS_SCRIPT, 1, serverAttemptsKey(mcpServerId))
    )
  )
}

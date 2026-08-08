import type { PersonalApiKeyPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { apiKey, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { hashApiKey } from '@/lib/api-key/crypto'
import { updateApiKeyLastUsed } from '@/lib/api-key/service'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

const logger = createLogger('V2ApiKeyAuth')

export type V2ApiKeyPrincipal = PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal

interface RateLimitSubscription {
  plan: string
  referenceId: string
}

export interface V2ApiKeyAuthContext {
  principal: V2ApiKeyPrincipal
  rolloutUserId: string
  rateLimitSubjectIds: readonly [string, ...string[]]
  rateLimitSubscription: RateLimitSubscription | null
  keyType: 'personal' | 'workspace'
}

export class V2ApiKeyUnauthenticatedError extends Error {
  constructor(message = 'Invalid API key') {
    super(message)
    this.name = 'V2ApiKeyUnauthenticatedError'
  }
}

interface ApiKeyRow {
  id: string
  userId: string
  workspaceId: string | null
  type: string
  expiresAt: Date | null
  userBanned: boolean | null
}

function requireValidRow(row: ApiKeyRow | undefined): ApiKeyRow {
  if (!row || (row.expiresAt && row.expiresAt < new Date())) {
    throw new V2ApiKeyUnauthenticatedError()
  }
  if (row.type === 'personal' && row.workspaceId === null) {
    if (row.userBanned === null) {
      throw new Error(`Personal API key ${row.id} is missing its credential owner`)
    }
    if (row.userBanned) throw new V2ApiKeyUnauthenticatedError()
    return row
  }
  if (row.type === 'workspace' && row.workspaceId) return row
  throw new Error(`API key ${row.id} has an invalid persisted type/workspace combination`)
}

export async function authenticateV2ApiKey(
  apiKeyHeader: string | null
): Promise<V2ApiKeyAuthContext> {
  if (isAuthDisabled) {
    return {
      principal: {
        kind: 'personal_api_key',
        userId: ANONYMOUS_USER_ID,
        keyId: 'auth-disabled',
      },
      rolloutUserId: ANONYMOUS_USER_ID,
      rateLimitSubjectIds: [`user:${ANONYMOUS_USER_ID}`],
      rateLimitSubscription: null,
      keyType: 'personal',
    }
  }
  if (!apiKeyHeader) {
    throw new V2ApiKeyUnauthenticatedError('API key required')
  }

  const [candidate] = await db
    .select({
      id: apiKey.id,
      userId: apiKey.userId,
      workspaceId: apiKey.workspaceId,
      type: apiKey.type,
      expiresAt: apiKey.expiresAt,
      userBanned: user.banned,
    })
    .from(apiKey)
    .leftJoin(user, eq(apiKey.userId, user.id))
    .where(eq(apiKey.keyHash, hashApiKey(apiKeyHeader)))
    .limit(1)
  const row = requireValidRow(candidate)

  await updateApiKeyLastUsed(row.id)
  logger.debug('Authenticated v2 API key', { keyId: row.id, keyType: row.type })

  if (row.type === 'personal') {
    const subscription = await getHighestPrioritySubscription(row.userId, { onError: 'throw' })
    return {
      principal: { kind: 'personal_api_key', userId: row.userId, keyId: row.id },
      rolloutUserId: row.userId,
      rateLimitSubjectIds: [`api-key:${row.id}`, `user:${row.userId}`],
      rateLimitSubscription: subscription
        ? { plan: subscription.plan, referenceId: subscription.referenceId }
        : null,
      keyType: 'personal',
    }
  }

  const workspaceId = row.workspaceId
  if (!workspaceId) {
    throw new Error(`Workspace API key ${row.id} is missing its workspace scope`)
  }
  const payer = await resolveWorkspaceBillingPayer(workspaceId)
  if (!payer) {
    throw new Error(`Workspace ${workspaceId} is missing its billing owner`)
  }
  return {
    principal: { kind: 'workspace_api_key', workspaceId, keyId: row.id },
    rolloutUserId: payer.billedAccountUserId,
    rateLimitSubjectIds: [`api-key:${row.id}`, `workspace:${workspaceId}`],
    rateLimitSubscription: payer.payerSubscription
      ? {
          plan: payer.payerSubscription.plan,
          referenceId: payer.payerSubscription.referenceId,
        }
      : null,
    keyType: 'workspace',
  }
}

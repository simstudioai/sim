import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { ApiKeyAccess } from '@sim/auth/principal'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { DAY_MS } from '@/lib/api/contracts/api-keys'
import { createApiKey, createWorkspaceApiKey } from '@/lib/api-key/auth'
import { hashApiKey } from '@/lib/api-key/crypto'
import { DELEGATION_KEY_NAME_PREFIX } from '@/lib/api-key/reserved-names'
import { PlatformEvents } from '@/lib/core/telemetry'

const logger = createLogger('ApiKeyOrchestration')

export type ApiKeyOrchestrationErrorCode = 'validation' | 'conflict' | 'internal'

export interface CreatedApiKey {
  id: string
  name: string
  key: string
  access: ApiKeyAccess
  createdAt: Date
  expiresAt: Date | null
}

/** The HTTP status a failed key creation answers with. */
export function apiKeyCreationErrorStatus(code: ApiKeyOrchestrationErrorCode | undefined): number {
  if (code === 'validation') return 400
  if (code === 'conflict') return 409
  return 500
}

/** The longest lifetime a key may be created with: a year, with a day of slack for clock skew. */
const MAX_API_KEY_LIFETIME_MS = 366 * DAY_MS

/**
 * The settings every key is issued with. Both default to a key that has always
 * existed: full access, never expiring.
 */
interface ApiKeyIssueSettings {
  access?: ApiKeyAccess
  /** ISO 8601 timestamp, or `null`/absent for a key that never expires. */
  expiresAt?: string | null
}

type ResolvedExpiry = { ok: true; expiresAt: Date | null } | { ok: false; error: string }

function resolveApiKeyExpiry(expiresAt: string | null | undefined): ResolvedExpiry {
  if (expiresAt === null || expiresAt === undefined) return { ok: true, expiresAt: null }
  const date = new Date(expiresAt)
  const lifetimeMs = date.getTime() - Date.now()
  if (!Number.isFinite(lifetimeMs)) {
    return { ok: false, error: 'Expiration must be a valid date' }
  }
  /** The shortest lifetime a key may be created with is one day. */
  if (lifetimeMs < DAY_MS) {
    return { ok: false, error: 'Expiration must be at least one day from now' }
  }
  if (lifetimeMs > MAX_API_KEY_LIFETIME_MS) {
    return { ok: false, error: 'Expiration must be within one year' }
  }
  return { ok: true, expiresAt: date }
}

type ResolvedIssueSettings =
  | { ok: true; access: ApiKeyAccess; expiresAt: Date | null }
  | { ok: false; error: string }

/** Validates what a caller asked a new key to be, before anything is written. */
function resolveIssueSettings(
  params: ApiKeyIssueSettings & { name: string }
): ResolvedIssueSettings {
  if (params.name.startsWith(DELEGATION_KEY_NAME_PREFIX)) {
    return { ok: false, error: `API key names may not start with "${DELEGATION_KEY_NAME_PREFIX}"` }
  }
  const access = params.access ?? 'write'
  const expiry = resolveApiKeyExpiry(params.expiresAt)
  if (!expiry.ok) return expiry
  return { ok: true, access, expiresAt: expiry.expiresAt }
}

export interface PerformCreateWorkspaceApiKeyParams extends ApiKeyIssueSettings {
  workspaceId: string
  userId: string
  name: string
  source?: string
  actorName?: string | null
  actorEmail?: string | null
  projectLegacyAudit?: boolean
  captureAnalytics?: boolean
}

export interface PerformCreateWorkspaceApiKeyResult {
  success: boolean
  error?: string
  errorCode?: ApiKeyOrchestrationErrorCode
  key?: CreatedApiKey
}

export interface PerformCreatePersonalApiKeyParams extends ApiKeyIssueSettings {
  userId: string
  name: string
  source?: string
  actorName?: string | null
  actorEmail?: string | null
  /** Forwarded to the audit record so the entry carries the caller's IP/UA. */
  request?: Request
}

export interface PerformCreatePersonalApiKeyResult {
  success: boolean
  error?: string
  errorCode?: ApiKeyOrchestrationErrorCode
  key?: CreatedApiKey
}

/**
 * Issues a personal API key for the given user.
 *
 * The single issuer for every caller — the settings route, which authenticates
 * by session, and the CLI key exchange, which authenticates by a redeemed
 * approval. Keeping name-collision handling, audit, and telemetry here means the
 * two surfaces can never drift.
 */
export async function performCreatePersonalApiKey(
  params: PerformCreatePersonalApiKeyParams
): Promise<PerformCreatePersonalApiKeyResult> {
  const settings = resolveIssueSettings(params)
  if (!settings.ok) return { success: false, errorCode: 'validation', error: settings.error }
  const { access, expiresAt } = settings
  try {
    const existing = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .where(
        and(
          eq(apiKey.userId, params.userId),
          eq(apiKey.name, params.name),
          eq(apiKey.type, 'personal')
        )
      )
      .limit(1)

    if (existing.length > 0) {
      return {
        success: false,
        errorCode: 'conflict',
        error: `A personal API key named "${params.name}" already exists. Please choose a different name.`,
      }
    }

    const { key: plainKey, encryptedKey } = await createApiKey(true)
    if (!encryptedKey) {
      throw new Error('Failed to encrypt API key for storage')
    }

    const [created] = await db
      .insert(apiKey)
      .values({
        id: generateShortId(),
        userId: params.userId,
        workspaceId: null,
        name: params.name,
        key: encryptedKey,
        keyHash: hashApiKey(plainKey),
        type: 'personal',
        access,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        access: apiKey.access,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
      })

    recordAudit({
      workspaceId: null,
      actorId: params.userId,
      actorName: params.actorName ?? undefined,
      actorEmail: params.actorEmail ?? undefined,
      action: AuditAction.PERSONAL_API_KEY_CREATED,
      resourceType: AuditResourceType.API_KEY,
      resourceId: created.id,
      resourceName: params.name,
      description: `Created personal API key: ${params.name}`,
      metadata: {
        keyName: params.name,
        keyType: 'personal',
        access,
        expiresAt: expiresAt?.toISOString() ?? null,
        source: params.source ?? 'settings',
      },
      request: params.request,
    })

    logger.info('Created personal API key', { userId: params.userId, keyId: created.id })

    return { success: true, key: { ...created, key: plainKey } }
  } catch (error) {
    logger.error('Failed to create personal API key', { error })
    // The CLI poll route is unauthenticated, so an internal failure never echoes its cause.
    return { success: false, errorCode: 'internal', error: 'Failed to create API key' }
  }
}

export async function performCreateWorkspaceApiKey(
  params: PerformCreateWorkspaceApiKeyParams
): Promise<PerformCreateWorkspaceApiKeyResult> {
  const settings = resolveIssueSettings(params)
  if (!settings.ok) return { success: false, errorCode: 'validation', error: settings.error }
  const { access, expiresAt } = settings
  try {
    const key = await createWorkspaceApiKey({
      workspaceId: params.workspaceId,
      userId: params.userId,
      name: params.name,
      access,
      expiresAt,
    })

    if (params.captureAnalytics !== false) {
      try {
        PlatformEvents.apiKeyGenerated({
          userId: params.userId,
          keyName: params.name,
        })
      } catch {}
    }

    logger.info('Created workspace API key', {
      workspaceId: params.workspaceId,
      keyId: key.id,
      name: params.name,
    })

    if (params.projectLegacyAudit !== false)
      recordAudit({
        workspaceId: params.workspaceId,
        actorId: params.userId,
        actorName: params.actorName ?? undefined,
        actorEmail: params.actorEmail ?? undefined,
        action: AuditAction.API_KEY_CREATED,
        resourceType: AuditResourceType.API_KEY,
        resourceId: key.id,
        resourceName: params.name,
        description: `Created API key "${params.name}"`,
        metadata: {
          keyName: params.name,
          keyType: 'workspace',
          access,
          expiresAt: expiresAt?.toISOString() ?? null,
          source: params.source ?? 'settings',
        },
      })

    return { success: true, key }
  } catch (error) {
    const message = toError(error).message
    logger.error('Failed to create workspace API key', { error })
    if (message.includes('already exists')) {
      return { success: false, error: message, errorCode: 'conflict' }
    }
    // The CLI poll route is unauthenticated, so an internal failure never echoes its cause.
    return { success: false, error: 'Failed to create API key', errorCode: 'internal' }
  }
}

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { createApiKey, createWorkspaceApiKey } from '@/lib/api-key/auth'
import { hashApiKey } from '@/lib/api-key/crypto'
import { PlatformEvents } from '@/lib/core/telemetry'

const logger = createLogger('ApiKeyOrchestration')

export type ApiKeyOrchestrationErrorCode = 'conflict' | 'internal'

export interface CreatedApiKey {
  id: string
  name: string
  key: string
  createdAt: Date
}

export interface PerformCreateWorkspaceApiKeyParams {
  workspaceId: string
  userId: string
  name: string
  source?: string
  actorName?: string | null
  actorEmail?: string | null
}

export interface PerformCreateWorkspaceApiKeyResult {
  success: boolean
  error?: string
  errorCode?: ApiKeyOrchestrationErrorCode
  key?: CreatedApiKey
}

export interface PerformCreatePersonalApiKeyParams {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
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
        source: params.source ?? 'settings',
      },
      request: params.request,
    })

    logger.info('Created personal API key', { userId: params.userId, keyId: created.id })

    return { success: true, key: { ...created, key: plainKey } }
  } catch (error) {
    logger.error('Failed to create personal API key', { error })
    return { success: false, errorCode: 'internal', error: toError(error).message }
  }
}

export async function performCreateWorkspaceApiKey(
  params: PerformCreateWorkspaceApiKeyParams
): Promise<PerformCreateWorkspaceApiKeyResult> {
  try {
    const key = await createWorkspaceApiKey({
      workspaceId: params.workspaceId,
      userId: params.userId,
      name: params.name,
    })

    try {
      PlatformEvents.apiKeyGenerated({
        userId: params.userId,
        keyName: params.name,
      })
    } catch {}

    logger.info('Created workspace API key', {
      workspaceId: params.workspaceId,
      keyId: key.id,
      name: params.name,
    })

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
        source: params.source ?? 'settings',
      },
    })

    return { success: true, key }
  } catch (error) {
    const message = toError(error).message
    logger.error('Failed to create workspace API key', { error })
    return {
      success: false,
      error: message,
      errorCode: message.includes('already exists') ? 'conflict' : 'internal',
    }
  }
}

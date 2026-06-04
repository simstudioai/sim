import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { createWorkspaceApiKey } from '@/lib/api-key/auth'
import { PlatformEvents } from '@/lib/core/telemetry'

const logger = createLogger('ApiKeyOrchestration')

export type ApiKeyOrchestrationErrorCode = 'conflict' | 'internal'

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
  key?: {
    id: string
    name: string
    key: string
    createdAt: Date
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

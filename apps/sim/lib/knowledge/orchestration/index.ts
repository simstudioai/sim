import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { KnowledgeBaseConflictError, restoreKnowledgeBase } from '@/lib/knowledge/service'

const logger = createLogger('KnowledgeBaseOrchestration')

export type KnowledgeOrchestrationErrorCode = 'not_found' | 'conflict' | 'internal'

export interface RestorableKnowledgeBase {
  id: string
  name: string
  workspaceId: string | null
  userId: string
}

export interface PerformRestoreKnowledgeBaseParams {
  knowledgeBaseId: string
  userId: string
  requestId?: string
}

export interface PerformRestoreKnowledgeBaseResult {
  success: boolean
  error?: string
  errorCode?: KnowledgeOrchestrationErrorCode
  knowledgeBase?: RestorableKnowledgeBase
}

export async function getRestorableKnowledgeBase(
  knowledgeBaseId: string
): Promise<RestorableKnowledgeBase | null> {
  const [kb] = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: knowledgeBase.workspaceId,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  return kb ?? null
}

export async function performRestoreKnowledgeBase(
  params: PerformRestoreKnowledgeBaseParams
): Promise<PerformRestoreKnowledgeBaseResult> {
  const { knowledgeBaseId, userId } = params
  const requestId = params.requestId ?? generateRequestId()

  const kb = await getRestorableKnowledgeBase(knowledgeBaseId)
  if (!kb) {
    return { success: false, error: 'Knowledge base not found', errorCode: 'not_found' }
  }

  try {
    await restoreKnowledgeBase(knowledgeBaseId, requestId)

    logger.info(`[${requestId}] Restored knowledge base ${knowledgeBaseId}`)

    recordAudit({
      workspaceId: kb.workspaceId,
      actorId: userId,
      action: AuditAction.KNOWLEDGE_BASE_RESTORED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: knowledgeBaseId,
      resourceName: kb.name,
      description: `Restored knowledge base "${kb.name}"`,
      metadata: {
        knowledgeBaseName: kb.name,
      },
    })

    return { success: true, knowledgeBase: kb }
  } catch (error) {
    logger.error(`[${requestId}] Failed to restore knowledge base ${knowledgeBaseId}`, { error })
    if (error instanceof KnowledgeBaseConflictError) {
      return { success: false, error: error.message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

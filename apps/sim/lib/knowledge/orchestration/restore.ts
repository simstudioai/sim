import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  auditActorFields,
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import { restoreKnowledgeBase } from '@/lib/knowledge/service'

const logger = createLogger('KnowledgeBaseRestoreOrchestration')

export interface RestorableKnowledgeBase {
  id: string
  name: string
  workspaceId: string | null
  userId: string
  /** `null` when the knowledge base is active — a restore is then a no-op. */
  deletedAt: Date | null
}

export interface PerformRestoreKnowledgeBaseParams extends KnowledgeOperationContext {
  knowledgeBaseId: string
  /**
   * `false` when an application use case projects the audit entry from the
   * authoritative result instead, so the restore is not recorded twice.
   */
  recordSemanticAudit?: boolean
}

export type PerformRestoreKnowledgeBaseResult = KnowledgeOrchestrationResult<{
  knowledgeBase: RestorableKnowledgeBase
}>

/**
 * Loads an archived knowledge base's identity so the caller can authorize the
 * restore. Reads regardless of `deletedAt` — an archived row is exactly what a
 * restore targets.
 */
export async function getRestorableKnowledgeBase(
  knowledgeBaseId: string
): Promise<RestorableKnowledgeBase | null> {
  const [kb] = await db
    .select({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: knowledgeBase.workspaceId,
      userId: knowledgeBase.userId,
      deletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .limit(1)

  return kb ?? null
}

/** Un-archives a knowledge base and its documents and connectors. */
export async function performRestoreKnowledgeBase(
  params: PerformRestoreKnowledgeBaseParams
): Promise<PerformRestoreKnowledgeBaseResult> {
  const { knowledgeBaseId, request, source } = params
  const requestId = params.requestId ?? generateRequestId()

  const kb = await getRestorableKnowledgeBase(knowledgeBaseId)
  if (!kb) {
    return fail('Knowledge base not found', 'not_found')
  }

  try {
    await restoreKnowledgeBase(knowledgeBaseId, requestId)
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Restore knowledge base ${knowledgeBaseId}`)
  }

  logger.info(`[${requestId}] Restored knowledge base ${knowledgeBaseId}`)

  if (params.recordSemanticAudit !== false) {
    recordAudit({
      workspaceId: kb.workspaceId,
      ...auditActorFields(params),
      action: AuditAction.KNOWLEDGE_BASE_RESTORED,
      resourceType: AuditResourceType.KNOWLEDGE_BASE,
      resourceId: knowledgeBaseId,
      resourceName: kb.name,
      description: `Restored knowledge base "${kb.name}"`,
      metadata: { source, knowledgeBaseName: kb.name },
      ...(request ? { request } : {}),
    })
  }

  return { success: true, knowledgeBase: kb }
}

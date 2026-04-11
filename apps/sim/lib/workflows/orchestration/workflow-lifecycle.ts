import { db } from '@sim/db'
import { templates, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { generateRequestId } from '@/lib/core/utils/request'
import { archiveWorkflow } from '@/lib/workflows/lifecycle'
import type { OrchestrationErrorCode } from '@/lib/workflows/orchestration/types'

const logger = createLogger('WorkflowLifecycle')

export interface PerformDeleteWorkflowParams {
  workflowId: string
  userId: string
  requestId?: string
  /** When 'delete', delete published templates. When 'orphan' (default), set their workflowId to null. */
  templateAction?: 'delete' | 'orphan'
  /** When true, allows deleting the last workflow in a workspace (used by admin API). */
  skipLastWorkflowGuard?: boolean
  /** Override the actor ID used in audit logs. Defaults to `userId`. */
  actorId?: string
}

export interface PerformDeleteWorkflowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
}

/**
 * Performs a full workflow deletion: enforces the last-workflow guard,
 * handles published templates, archives the workflow via `archiveWorkflow`,
 * and records an audit entry. Both the workflow API DELETE handler and the
 * copilot delete_workflow tool must use this function.
 */
export async function performDeleteWorkflow(
  params: PerformDeleteWorkflowParams
): Promise<PerformDeleteWorkflowResult> {
  const { workflowId, userId, templateAction = 'orphan', skipLastWorkflowGuard = false } = params
  const actorId = params.actorId ?? userId
  const requestId = params.requestId ?? generateRequestId()

  const [workflowRecord] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  if (!skipLastWorkflowGuard && workflowRecord.workspaceId) {
    const totalWorkflows = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workflowRecord.workspaceId), isNull(workflow.archivedAt)))

    if (totalWorkflows.length <= 1) {
      return {
        success: false,
        error: 'Cannot delete the only workflow in the workspace',
        errorCode: 'validation',
      }
    }
  }

  try {
    const publishedTemplates = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.workflowId, workflowId))

    if (publishedTemplates.length > 0) {
      if (templateAction === 'delete') {
        await db.delete(templates).where(eq(templates.workflowId, workflowId))
        logger.info(
          `[${requestId}] Deleted ${publishedTemplates.length} templates for workflow ${workflowId}`
        )
      } else {
        await db
          .update(templates)
          .set({ workflowId: null })
          .where(eq(templates.workflowId, workflowId))
        logger.info(
          `[${requestId}] Orphaned ${publishedTemplates.length} templates for workflow ${workflowId}`
        )
      }
    }
  } catch (templateError) {
    logger.warn(`[${requestId}] Failed to handle templates for workflow ${workflowId}`, {
      error: templateError,
    })
  }

  const archiveResult = await archiveWorkflow(workflowId, { requestId })
  if (!archiveResult.workflow) {
    return { success: false, error: 'Workflow not found', errorCode: 'not_found' }
  }

  logger.info(`[${requestId}] Successfully archived workflow ${workflowId}`)

  recordAudit({
    workspaceId: workflowRecord.workspaceId || null,
    actorId: actorId,
    action: AuditAction.WORKFLOW_DELETED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    resourceName: workflowRecord.name,
    description: `Archived workflow "${workflowRecord.name}"`,
    metadata: {
      archived: archiveResult.archived,
      templateAction,
    },
  })

  return { success: true }
}

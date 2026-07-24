import type { workflowBlockAnnotation } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { WorkflowAnnotationApi } from '@/lib/api/contracts/workflow-annotations'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'

const logger = createLogger('WorkflowAnnotations')

type WorkflowBlockAnnotationRow = typeof workflowBlockAnnotation.$inferSelect

/**
 * Serializes a workflow block annotation row into the contract wire shape.
 */
export function serializeWorkflowAnnotation(row: WorkflowBlockAnnotationRow): WorkflowAnnotationApi {
  return {
    id: row.id,
    workflowId: row.workflowId,
    blockId: row.blockId,
    content: row.content,
    createdBy: row.createdBy,
    resolved: row.resolved,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Notifies the realtime server that a workflow's block annotations changed so
 * connected collaborators can refetch. Fire-and-forget: failures are logged and
 * never surfaced to the caller.
 */
export async function notifyAnnotationsUpdated(workflowId: string): Promise<void> {
  try {
    const socketResponse = await fetch(`${getSocketServerUrl()}/api/workflow-annotations-updated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId }),
    })

    if (!socketResponse.ok) {
      logger.warn(`Failed to notify Socket.IO about annotation change for workflow ${workflowId}`)
    }
  } catch (error) {
    logger.warn(`Error notifying Socket.IO about annotation change for workflow ${workflowId}`, {
      error,
    })
  }
}

import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { updateWorkflowRecord } from '@/lib/workflows/orchestration'

const MAX_BULK_WORKFLOW_MOVES = 100

export interface MoveWorkflowsBulkInput {
  workspaceId: string
  workflowIds: string[]
  folderId: string | null
}

interface MovedWorkflow {
  id: string
  name: string
  previousFolderId: string | null
}

export interface MoveWorkflowsBulkResult {
  moved: string[]
  failed: string[]
  folderId: string | null
  changes: MovedWorkflow[]
}

function normalizeWorkflowIds(workflowIds: readonly string[]): string[] {
  const normalized = [...new Set(workflowIds.filter((id) => id.length > 0))]
  if (normalized.length === 0) {
    throw new OrchestrationError('validation', 'workflowIds is required')
  }
  if (normalized.length > MAX_BULK_WORKFLOW_MOVES) {
    throw new OrchestrationError(
      'validation',
      `Workflow moves cannot exceed ${MAX_BULK_WORKFLOW_MOVES} items`
    )
  }
  return normalized
}

function requireMutable(workflowId: string, folderId: string | null): Promise<void> {
  return Promise.all([assertWorkflowMutable(workflowId), assertFolderMutable(folderId)])
    .then(() => undefined)
    .catch((error: unknown) => {
      if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
        throw new OrchestrationError('locked', error.message)
      }
      throw error
    })
}

export const moveWorkflowsBulk = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.moveBulk,
  resolveContext: ({ input }: { input: MoveWorkflowsBulkInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<MoveWorkflowsBulkResult> {
    const workflowIds = normalizeWorkflowIds(input.workflowIds)
    const rows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        folderId: workflow.folderId,
      })
      .from(workflow)
      .where(
        and(
          inArray(workflow.id, workflowIds),
          eq(workflow.workspaceId, context.workspaceId),
          isNull(workflow.archivedAt)
        )
      )
    const byId = new Map(rows.map((row) => [row.id, row]))
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const moved: string[] = []
    const failed: string[] = []
    const changes: MovedWorkflow[] = []

    for (const workflowId of workflowIds) {
      const indexed = byId.get(workflowId)
      if (!indexed) {
        failed.push(workflowId)
        continue
      }

      try {
        await requireMutable(workflowId, input.folderId)
        const changed = await db.transaction(async (tx) => {
          const [current] = await tx
            .select({
              id: workflow.id,
              name: workflow.name,
              folderId: workflow.folderId,
            })
            .from(workflow)
            .where(
              and(
                eq(workflow.id, workflowId),
                eq(workflow.workspaceId, context.workspaceId),
                isNull(workflow.archivedAt)
              )
            )
            .limit(1)
            .for('update')
          if (!current) throw new OrchestrationError('not_found', 'Workflow not found')

          const transition = await updateWorkflowRecord({
            workflowId,
            userId: attribution.attributedUserId,
            workspaceId: context.workspaceId,
            currentName: current.name,
            currentFolderId: current.folderId,
            folderId: input.folderId,
            tx,
          })
          requireWorkflowTransition(transition, 'Failed to move workflow')
          return current
        })
        moved.push(workflowId)
        changes.push({
          id: workflowId,
          name: changed.name,
          previousFolderId: changed.folderId,
        })
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (!classified || classified.code === 'internal') throw error
        failed.push(workflowId)
      }
    }

    return { moved, failed, folderId: input.folderId, changes }
  },
  projectAudit: ({ result }) =>
    result.changes.map((change) => ({
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: change.id,
      resourceName: change.name,
      description: `Moved workflow "${change.name}"`,
      metadata: {
        previousFolderId: change.previousFolderId,
        folderId: result.folderId,
      },
    })),
  afterSuccess: async ({ result }) => {
    for (const workflowId of result.moved) {
      await notifyWorkflowUpdated(workflowId)
    }
  },
})

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
import { principalAuditSource } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/workflow-folders'
import { updateWorkflowRecord } from '@/lib/workflows/orchestration'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const MAX_BULK_WORKFLOW_MOVES = 100

export interface MoveWorkflowsBulkInput {
  workspaceId: string
  workflowIds: string[]
  /** Canonical destination folder. Mutually exclusive with `folderPath`. */
  folderId?: string | null
  /** Destination folder by path, resolved against the workspace's folder tree. */
  folderPath?: string
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
    if (input.folderPath !== undefined && input.folderId !== undefined) {
      throw new OrchestrationError('validation', 'Provide either folderPath or folderId, not both')
    }
    const workflowIds = normalizeWorkflowIds(input.workflowIds)
    const folderId =
      input.folderPath === undefined
        ? (input.folderId ?? null)
        : (await resolveWorkflowFolderPath(context.workspaceId, input.folderPath)).folderId
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
        await requireMutable(workflowId, folderId)
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
            folderId,
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

    return { moved, failed, folderId, changes }
  },
  projectAudit: ({ principal, result }) =>
    result.changes.map((change) => ({
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: change.id,
      resourceName: change.name,
      description: `Moved workflow "${change.name}"`,
      metadata: {
        previousFolderId: change.previousFolderId,
        folderId: result.folderId,
        source: principalAuditSource(principal),
      },
    })),
  afterSuccess: async ({ context, result }) => {
    for (const workflowId of result.moved) {
      await notifyWorkflowUpdated(workflowId)
    }
    if (result.moved.length > 0) {
      await notifyWorkspaceWorkflowsChanged(context.workspaceId)
    }
  },
})

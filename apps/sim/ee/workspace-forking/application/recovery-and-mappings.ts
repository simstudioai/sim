import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { user, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { UpdateForkMappingBody } from '@/lib/api/contracts/workspace-fork'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { recordBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'
import { acquireForkEdgeLock, setForkLockTimeout } from '@/ee/workspace-forking/lib/lineage/lineage'
import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'
import { reconcileForkDependentValues } from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import {
  type ApplyForkMappingEntry,
  applyForkMappingEntries,
  overlayForkMappingEntries,
  validateForkMappingTargets,
} from '@/ee/workspace-forking/lib/mapping/mapping-service'
import { getEdgeMappingRows } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import { rollbackFork } from '@/ee/workspace-forking/lib/promote/rollback'

const logger = createLogger('WorkspaceForkRecovery')
const AUDIT_NAME_LIMIT = 20

interface EdgeInput {
  workspaceId: string
  otherWorkspaceId: string
}
interface MappingInput extends EdgeInput {
  direction: 'push' | 'pull'
  mappings: ApplyForkMappingEntry[]
  dependentValues?: UpdateForkMappingBody['dependentValues']
}

export const updateWorkspaceForkMappings = defineForkUseCase<
  typeof forkOperations.mappingsUpdate,
  MappingInput,
  { updated: number }
>({
  operation: forkOperations.mappingsUpdate,
  bothSides: true,
  edge: true,
  async execute({ principal, input, context }) {
    const edge = context.edge!
    const sourceWorkspaceId =
      input.direction === 'push' ? input.workspaceId : input.otherWorkspaceId
    const targetWorkspaceId =
      input.direction === 'push' ? input.otherWorkspaceId : input.workspaceId
    return db.transaction(async (tx) => {
      await setForkLockTimeout(tx)
      await acquireForkEdgeLock(tx, edge.childWorkspaceId)
      const [currentEdge] = await tx
        .select({ parentId: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(and(eq(workspace.id, edge.childWorkspaceId), isNull(workspace.archivedAt)))
        .for('update')
        .limit(1)
      if (currentEdge?.parentId !== edge.parentWorkspaceId)
        throw new OrchestrationError('conflict', 'Fork lineage changed')
      await validateForkMappingTargets(sourceWorkspaceId, targetWorkspaceId, input.mappings, tx)
      overlayForkMappingEntries(
        await getEdgeMappingRows(tx, edge.childWorkspaceId),
        edge,
        sourceWorkspaceId,
        input.mappings
      )
      const updated = await applyForkMappingEntries(
        tx,
        edge,
        principal.userId,
        sourceWorkspaceId,
        input.mappings
      )
      if (input.dependentValues !== undefined) {
        const targetWorkflowIds = [
          ...new Set(input.dependentValues.map((value) => value.workflowId)),
        ]
        const targetRows = targetWorkflowIds.length
          ? await tx
              .select({ id: workflow.id })
              .from(workflow)
              .where(
                and(
                  inArray(workflow.id, targetWorkflowIds),
                  eq(workflow.workspaceId, targetWorkspaceId),
                  isNull(workflow.archivedAt)
                )
              )
          : []
        if (targetRows.length !== targetWorkflowIds.length)
          throw new OrchestrationError(
            'validation',
            'Dependent values must belong to destination workflows'
          )
        await reconcileForkDependentValues(
          tx,
          edge.childWorkspaceId,
          targetWorkflowIds,
          input.dependentValues.map((entry) => ({
            targetWorkflowId: entry.workflowId,
            targetBlockId: entry.blockId,
            subBlockKey: entry.subBlockKey,
            value: entry.value,
          }))
        )
      }
      return { updated }
    })
  },
})

export const rollbackWorkspaceFork = defineForkUseCase<
  typeof forkOperations.rollback,
  EdgeInput,
  Awaited<ReturnType<typeof rollbackFork>>
>({
  operation: forkOperations.rollback,
  execute: ({ principal, input }) =>
    rollbackFork({
      targetWorkspaceId: input.workspaceId,
      otherWorkspaceId: input.otherWorkspaceId,
      userId: principal.userId,
      requestId: generateShortId(),
    }),
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.WORKSPACE_FORK_ROLLED_BACK,
    resourceType: AuditResourceType.WORKSPACE,
    resourceId: input.workspaceId,
    resourceName: context.workspace.name,
    description: `Rolled back the last promote into "${context.workspace.name}"`,
    metadata: { otherWorkspaceId: input.otherWorkspaceId, ...result },
  }),
  async afterSuccess({ principal, input, result }) {
    try {
      const [other] = await db
        .select({ name: workspace.name, actorName: user.name })
        .from(workspace)
        .leftJoin(user, eq(user.id, principal.userId))
        .where(eq(workspace.id, input.otherWorkspaceId))
        .limit(1)
      const otherName = other?.name ?? 'the source workspace'
      const pendingActivations = result.pendingActivations.length
      await recordBackgroundWork(db, {
        workspaceId: input.workspaceId,
        kind: 'fork_rollback',
        status:
          result.skipped > 0 || pendingActivations > 0 ? 'completed_with_warnings' : 'completed',
        message:
          pendingActivations > 0
            ? `Undid the last sync from "${otherName}" — ${pendingActivations} deployment(s) still activating`
            : `Undid the last sync from "${otherName}"`,
        metadata: {
          actorName: other?.actorName ?? undefined,
          otherWorkspaceId: input.otherWorkspaceId,
          otherWorkspaceName: otherName,
          restored: result.restored,
          removed: result.archived,
          unarchived: result.unarchived,
          skipped: result.skipped,
          pendingActivations,
        },
      })
    } catch (error) {
      logger.error('Failed to record rollback activity', { error: getErrorMessage(error) })
    }
  },
})

export const unlinkWorkspaceFork = defineForkUseCase<
  typeof forkOperations.unlink,
  EdgeInput,
  Awaited<ReturnType<typeof unlinkForkEdge>>
>({
  operation: forkOperations.unlink,
  edge: true,
  execute: ({ context }) => unlinkForkEdge(context.edge!, generateShortId()),
  projectAudit: ({ input, result }) =>
    result.unlinked
      ? {
          action: AuditAction.WORKSPACE_FORK_UNLINKED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: input.workspaceId,
          metadata: { otherWorkspaceId: input.otherWorkspaceId },
        }
      : [],
})

export const updateWorkspaceForkExclusions = defineForkUseCase<
  typeof forkOperations.exclusions,
  { workspaceId: string; workflowIds: string[]; forkSyncExcluded: boolean },
  { updated: number; workflowNames: string[] }
>({
  operation: forkOperations.exclusions,
  async execute({ input }) {
    const rows = await db
      .update(workflow)
      .set({ forkSyncExcluded: input.forkSyncExcluded, updatedAt: new Date() })
      .where(
        and(
          inArray(workflow.id, input.workflowIds),
          eq(workflow.workspaceId, input.workspaceId),
          isNull(workflow.archivedAt),
          ne(workflow.forkSyncExcluded, input.forkSyncExcluded)
        )
      )
      .returning({ id: workflow.id, name: workflow.name })
    return {
      updated: rows.length,
      workflowNames: rows.slice(0, AUDIT_NAME_LIMIT).map((row) => row.name),
    }
  },
  projectAudit: ({ input, context, result }) =>
    result.updated
      ? {
          action: input.forkSyncExcluded
            ? AuditAction.WORKFLOW_FORK_SYNC_EXCLUDED
            : AuditAction.WORKFLOW_FORK_SYNC_INCLUDED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: input.workspaceId,
          resourceName: context.workspace.name,
          description: `${input.forkSyncExcluded ? 'Excluded' : 'Included'} ${result.updated} workflow(s) ${input.forkSyncExcluded ? 'from' : 'in'} fork sync`,
          metadata: {
            forkSyncExcluded: input.forkSyncExcluded,
            workflowCount: result.updated,
            workflowNames: result.workflowNames,
          },
        }
      : [],
  afterSuccess({ principal, input, result }) {
    if (!result.updated) return
    captureServerEvent(
      principal.userId,
      'fork_excluded_workflows_updated',
      {
        workspace_id: input.workspaceId,
        workflow_count: result.updated,
        fork_sync_excluded: input.forkSyncExcluded,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
})

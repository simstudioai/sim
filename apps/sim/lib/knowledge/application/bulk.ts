import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { classifyBulkItemError } from '@/lib/core/application/bulk-items'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  bulkDeleteFolders,
  bulkMoveFolders,
  foldFolderPlan,
  planFolderSelection,
} from '@/lib/folders/bulk'
import { findActiveFolder } from '@/lib/folders/queries'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  type BoundedKnowledgeSelection,
  BULK_DELETE_KNOWLEDGE_ITEMS_COST_POLICY,
  BULK_MOVE_KNOWLEDGE_ITEMS_COST_POLICY,
  type KnowledgeBatchExecutionResult,
  requireBoundedKnowledgeSelection,
  rethrowKnowledgeBatchTerminalFailure,
} from '@/lib/knowledge/application/batch-policy'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  type KnowledgeWorkspaceContext,
  resolveActiveKnowledgeBaseInWorkspace,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { authorizeSearchIndexDeletion } from '@/lib/knowledge/application/knowledge-base-access'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { deleteKnowledgeBase, updateKnowledgeBase } from '@/lib/knowledge/service'

const logger = createLogger('KnowledgeBulkApplication')

const KNOWLEDGE_FOLDER_RESOURCE_TYPE = 'knowledge_base' as const

export type BulkKnowledgeItemKind = 'knowledgeBase' | 'folder'

export interface BulkKnowledgeItem {
  kind: BulkKnowledgeItemKind
  id: string
  name: string
}

export interface BulkKnowledgeFailure extends BulkKnowledgeItem {
  reason: string
}

/** An id the batch could not resolve. No name, because nothing was found to name. */
export interface BulkKnowledgeMissing {
  kind: BulkKnowledgeItemKind
  id: string
}

interface BulkKnowledgeContext extends KnowledgeWorkspaceContext, BoundedKnowledgeSelection {}

export interface BulkMoveKnowledgeItemsInput {
  assertedWorkspaceId: string
  knowledgeBaseIds: string[]
  folderIds: string[]
  targetFolderId: string | null
  source?: string
}

export interface BulkDeleteKnowledgeItemsInput {
  assertedWorkspaceId: string
  knowledgeBaseIds: string[]
  folderIds: string[]
  source?: string
}

interface BulkKnowledgeOutcome {
  skipped: BulkKnowledgeItem[]
  notFound: BulkKnowledgeMissing[]
  failed: BulkKnowledgeFailure[]
}

export interface BulkMoveKnowledgeItemsResult extends BulkKnowledgeOutcome {
  moved: BulkKnowledgeItem[]
}

export interface BulkDeleteKnowledgeItemsResult extends BulkKnowledgeOutcome {
  deleted: BulkKnowledgeItem[]
  /** Totals across the explicit deletes and every folder cascade they triggered. */
  deletedItems: { knowledgeBases: number; folders: number }
}

interface BulkMoveKnowledgeItemsExecutionResult
  extends BulkMoveKnowledgeItemsResult,
    KnowledgeBatchExecutionResult {}
interface BulkDeleteKnowledgeItemsExecutionResult
  extends BulkDeleteKnowledgeItemsResult,
    KnowledgeBatchExecutionResult {}

async function resolveBulkKnowledgeContext(
  input: { assertedWorkspaceId: string; knowledgeBaseIds: string[]; folderIds: string[] },
  maxItems: number
): Promise<BulkKnowledgeContext> {
  const selection = requireBoundedKnowledgeSelection(
    input.knowledgeBaseIds,
    input.folderIds,
    maxItems
  )
  return {
    ...(await resolveKnowledgeWorkspaceContext({ workspaceId: input.assertedWorkspaceId })),
    ...selection,
  }
}

/**
 * Walks the knowledge-base half of the selection.
 *
 * A base filed inside one of the selected folders is skipped: the folder
 * operation already carries it, and acting on it separately would either pull
 * it out of the folder it is travelling with or archive it under a second
 * timestamp its folder's restore could never recover.
 */
async function runKnowledgeItems(
  knowledgeBaseIds: readonly string[],
  workspace: KnowledgeWorkspaceContext,
  principal: Principal,
  covered: ReadonlySet<string>,
  authorize: (canonical: ActiveKnowledgeBaseContext) => Promise<void>,
  apply: (canonical: ActiveKnowledgeBaseContext) => Promise<string>,
  succeeded: BulkKnowledgeItem[],
  outcome: BulkKnowledgeOutcome
): Promise<unknown | undefined> {
  for (const knowledgeBaseId of knowledgeBaseIds) {
    let knowledgeBaseName = knowledgeBaseId
    try {
      const canonical = await resolveActiveKnowledgeBaseInWorkspace(
        knowledgeBaseId,
        workspace,
        principal
      )
      knowledgeBaseName = canonical.knowledgeBase.name
      const folderId = canonical.knowledgeBase.folderId
      if (folderId && covered.has(folderId)) {
        outcome.skipped.push({
          kind: 'knowledgeBase',
          id: canonical.knowledgeBaseId,
          name: knowledgeBaseName,
        })
        continue
      }
      await authorize(canonical)
      succeeded.push({
        kind: 'knowledgeBase',
        id: canonical.knowledgeBaseId,
        name: await apply(canonical),
      })
    } catch (error) {
      const disposition = classifyBulkItemError(error)
      if (disposition.kind === 'notFound') {
        outcome.notFound.push({ kind: 'knowledgeBase', id: knowledgeBaseId })
        continue
      }
      if (disposition.kind === 'failed') {
        outcome.failed.push({
          kind: 'knowledgeBase',
          id: knowledgeBaseId,
          name: knowledgeBaseName,
          reason: disposition.reason,
        })
        continue
      }
      return disposition.error
    }
  }
  return undefined
}

export const bulkMoveKnowledgeItems = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkMoveItems,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: BulkMoveKnowledgeItemsInput
  }) => resolveBulkKnowledgeContext(input, BULK_MOVE_KNOWLEDGE_ITEMS_COST_POLICY.maxItems),
  async execute({ principal, input, context }): Promise<BulkMoveKnowledgeItemsExecutionResult> {
    /**
     * The destination check and the folder plan read different rows and share
     * no data, so they overlap rather than serialize. Both still complete
     * before anything is written: an invalid target must fail the whole request
     * rather than leave half the selection moved.
     */
    const [targetFolder, plan] = await Promise.all([
      input.targetFolderId === null
        ? null
        : findActiveFolder(
            input.targetFolderId,
            context.workspaceId,
            KNOWLEDGE_FOLDER_RESOURCE_TYPE
          ),
      planFolderSelection(context.workspaceId, KNOWLEDGE_FOLDER_RESOURCE_TYPE, context.folderIds),
    ])
    if (input.targetFolderId !== null && !targetFolder) {
      throw new OrchestrationError('not_found', 'Folder not found in this workspace')
    }

    /**
     * The target must not be inside the subtree that is moving. `plan.covered` is exactly the
     * selected folders plus their descendants, so this rejects both "into itself" and "into its
     * own child" before anything is written. Without it the resources move, the folders then fail
     * their cycle check, and the caller is left with a half-applied selection.
     *
     * This is a fast-fail optimization, not the enforcement point. It reads a snapshot taken
     * outside the folder mutation lock, so a concurrent reparent can invalidate it between the
     * check and the write. The invariant itself is enforced where it must be — `updateFolder`
     * re-checks `wouldCreateFolderCycle` inside `acquireFolderMutationLock`, so a cycle is never
     * created. Losing that race costs a reported per-folder `failed` alongside resources that
     * did move, which is the batch's documented `sequential_best_effort` outcome, not corruption.
     */
    if (input.targetFolderId !== null && plan.covered.has(input.targetFolderId)) {
      throw new OrchestrationError(
        'validation',
        'Cannot move a folder into itself or one of its own subfolders'
      )
    }

    const moved: BulkKnowledgeItem[] = []
    const outcome: BulkKnowledgeOutcome = { skipped: [], notFound: [], failed: [] }
    foldFolderPlan(plan, outcome)

    const terminalError = await runKnowledgeItems(
      context.knowledgeBaseIds,
      context,
      principal,
      plan.covered,
      (canonical) =>
        authorizeWorkspaceOperation(principal, knowledgeOperations.bulkMoveItems, canonical, {
          delegation: knowledgeDelegationPolicy,
        }),
      async (canonical) =>
        (
          await updateKnowledgeBase(
            canonical.knowledgeBaseId,
            { folderId: input.targetFolderId },
            generateRequestId(),
            { assertedWorkspaceId: context.workspaceId }
          )
        ).name,
      moved,
      outcome
    )

    if (terminalError === undefined && plan.selected.length > 0) {
      const folders = await bulkMoveFolders({
        workspaceId: context.workspaceId,
        resourceType: KNOWLEDGE_FOLDER_RESOURCE_TYPE,
        userId: resolveKnowledgeAttributedUserId(principal, context),
        folders: plan.selected,
        targetParentId: input.targetFolderId,
      })
      for (const folder of folders.succeeded) moved.push({ kind: 'folder', ...folder })
      for (const folder of folders.failed) outcome.failed.push({ kind: 'folder', ...folder })
    }

    logger.info('Bulk moved knowledge bases and folders', {
      workspaceId: context.workspaceId,
      moved: moved.length,
      skipped: outcome.skipped.length,
      notFound: outcome.notFound.length,
      failed: outcome.failed.length,
    })
    return {
      moved,
      ...outcome,
      ...(terminalError !== undefined && { terminalFailure: { error: terminalError } }),
    }
  },
  projectAudit: ({ input, result }) =>
    result.moved.map((item) =>
      item.kind === 'folder'
        ? {
            action: AuditAction.FOLDER_MOVED,
            resourceType: AuditResourceType.FOLDER,
            resourceId: item.id,
            resourceName: item.name,
            description:
              input.targetFolderId === null
                ? `Moved knowledge base folder "${item.name}" to the workspace root`
                : `Moved knowledge base folder "${item.name}" into another folder`,
            metadata: {
              source: input.source,
              folderResourceType: KNOWLEDGE_FOLDER_RESOURCE_TYPE,
              parentId: input.targetFolderId,
              bulk: true,
            },
          }
        : {
            action: AuditAction.KNOWLEDGE_BASE_UPDATED,
            resourceType: AuditResourceType.KNOWLEDGE_BASE,
            resourceId: item.id,
            resourceName: item.name,
            description:
              input.targetFolderId === null
                ? `Moved knowledge base "${item.name}" to the workspace root`
                : `Moved knowledge base "${item.name}" into a folder`,
            metadata: {
              source: input.source,
              updatedFields: ['folderId'],
              folderId: input.targetFolderId,
              bulk: true,
            },
          }
    ),
  afterSuccess: ({ result }) => {
    rethrowKnowledgeBatchTerminalFailure(result)
  },
})

export const bulkDeleteKnowledgeItems = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.bulkDeleteItems,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: BulkDeleteKnowledgeItemsInput
  }) => resolveBulkKnowledgeContext(input, BULK_DELETE_KNOWLEDGE_ITEMS_COST_POLICY.maxItems),
  async execute({ principal, context }): Promise<BulkDeleteKnowledgeItemsExecutionResult> {
    const plan = await planFolderSelection(
      context.workspaceId,
      KNOWLEDGE_FOLDER_RESOURCE_TYPE,
      context.folderIds
    )

    const deleted: BulkKnowledgeItem[] = []
    const outcome: BulkKnowledgeOutcome = { skipped: [], notFound: [], failed: [] }
    foldFolderPlan(plan, outcome)

    const terminalError = await runKnowledgeItems(
      context.knowledgeBaseIds,
      context,
      principal,
      plan.covered,
      (canonical) =>
        authorizeWorkspaceOperation(principal, knowledgeOperations.bulkDeleteItems, canonical, {
          delegation: knowledgeDelegationPolicy,
        }),
      async (canonical) => {
        const allowSearchIndexDelete = await authorizeSearchIndexDeletion(
          principal,
          canonical,
          canonical.knowledgeBase
        )
        await deleteKnowledgeBase(canonical.knowledgeBaseId, generateRequestId(), {
          assertedWorkspaceId: context.workspaceId,
          allowSearchIndexDelete,
        })
        return canonical.knowledgeBase.name
      },
      deleted,
      outcome
    )

    const deletedItems = { knowledgeBases: deleted.length, folders: 0 }
    if (terminalError === undefined && plan.selected.length > 0) {
      const folders = await bulkDeleteFolders({
        workspaceId: context.workspaceId,
        resourceType: KNOWLEDGE_FOLDER_RESOURCE_TYPE,
        userId: resolveKnowledgeAttributedUserId(principal, context),
        folders: plan.selected,
        countKey: 'knowledgeBases',
      })
      for (const folder of folders.succeeded) deleted.push({ kind: 'folder', ...folder })
      for (const folder of folders.failed) outcome.failed.push({ kind: 'folder', ...folder })
      deletedItems.folders = folders.folderCount
      deletedItems.knowledgeBases += folders.resourceCount
    }

    logger.info('Bulk deleted knowledge bases and folders', {
      workspaceId: context.workspaceId,
      deleted: deleted.length,
      skipped: outcome.skipped.length,
      notFound: outcome.notFound.length,
      failed: outcome.failed.length,
      deletedItems,
    })
    return {
      deleted,
      deletedItems,
      ...outcome,
      ...(terminalError !== undefined && { terminalFailure: { error: terminalError } }),
    }
  },
  /**
   * One entry per item the batch actually deleted. A folder's entry carries the
   * cascade counts rather than one entry per cascaded knowledge base, matching
   * what `DELETE /api/folders/[id]` already records for a single folder — a
   * cascade is unbounded, and per-resource entries would let one request write
   * thousands of audit rows.
   */
  projectAudit: ({ input, result }) =>
    result.deleted.map((item) =>
      item.kind === 'folder'
        ? {
            action: AuditAction.FOLDER_DELETED,
            resourceType: AuditResourceType.FOLDER,
            resourceId: item.id,
            resourceName: item.name,
            description: `Deleted knowledge base folder "${item.name}"`,
            metadata: {
              source: input.source,
              folderResourceType: KNOWLEDGE_FOLDER_RESOURCE_TYPE,
              affected: result.deletedItems,
              bulk: true,
            },
          }
        : {
            action: AuditAction.KNOWLEDGE_BASE_DELETED,
            resourceType: AuditResourceType.KNOWLEDGE_BASE,
            resourceId: item.id,
            resourceName: item.name,
            description: `Deleted knowledge base "${item.name}"`,
            metadata: { source: input.source, knowledgeBaseName: item.name, bulk: true },
          }
    ),
  afterSuccess: ({ result }) => {
    try {
      for (const item of result.deleted) {
        if (item.kind === 'knowledgeBase') {
          PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: item.id })
        }
      }
    } finally {
      rethrowKnowledgeBatchTerminalFailure(result)
    }
  },
})

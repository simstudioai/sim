import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { omit } from '@sim/utils/object'
import type { BlockCatalog, SourceFingerprint } from '@sim/workflow-code'
import {
  readWorkflowSourceMeta,
  writeWorkflowSourceMeta,
} from '@sim/workflow-persistence/source-meta'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { WorkflowSourceStaleError } from '@/lib/workflows/application/source-error'
import type { SourcePlan } from '@/lib/workflows/application/source-evaluate'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { assertLockedBlocksPreserved } from '@/lib/workflows/code/apply/locked'
import { fingerprintOf, type StoredSource } from '@/lib/workflows/code/apply/print'
import { mergeSourceMetaFromLock } from '@/lib/workflows/code/source-lock'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration'
import { assertNoWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  type PreparedWorkflowState,
  prepareWorkflowStateForPersistence,
} from '@/lib/workflows/persistence/prepare-state'
import {
  assertWorkflowGraphIdsUnclaimed,
  collectWorkflowGraphIds,
  replaceWorkflowNormalizedState,
  WorkflowStatePersistenceError,
} from '@/lib/workflows/persistence/replace-normalized-state'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'

const logger = createLogger('WorkflowSourceCommit')

/** What a commit (or a dry run's preview of one) stores, after persistence preparation. */
interface CommittedGraph {
  state: PreparedWorkflowState
  warnings: string[]
}

interface CommitScope {
  workflowId: string
  workspaceId: string
  subjectUserId: string
}

/**
 * What a dry run would store: the plan's graph prepared for persistence, refused when another
 * workflow already stores one of its ids, exactly as the write would refuse it.
 */
export async function previewSourceCommit(
  workflowId: string,
  plan: SourcePlan
): Promise<CommittedGraph> {
  const prepared = prepareWorkflowStateForPersistence({ blocks: plan.blocks, edges: plan.edges })
  await assertWorkflowGraphIdsUnclaimed(db, workflowId, collectWorkflowGraphIds(prepared.state))
  return prepared
}

/**
 * The stored draft re-read under the row lock: blocks, edges and the row's variables and meta.
 * Refuses (423) a workflow locked, directly or by a folder above it, after the use case's
 * `requireMutableWorkflow` ran: locking a workflow updates this row, so it waits for the lock this
 * transaction holds and cannot slip in between the check and the write.
 */
async function loadMutableStoredSourceIn(tx: DbOrTx, workflowId: string): Promise<StoredSource> {
  const [normalized, [row]] = await Promise.all([
    loadWorkflowFromNormalizedTables(workflowId, tx),
    tx
      .select({
        name: workflowTable.name,
        description: workflowTable.description,
        variables: workflowTable.variables,
        locked: workflowTable.locked,
        folderId: workflowTable.folderId,
      })
      .from(workflowTable)
      .where(and(eq(workflowTable.id, workflowId), isNull(workflowTable.archivedAt)))
      .limit(1),
  ])
  if (!row) throw new OrchestrationError('not_found', 'Workflow not found')
  if (row.locked) throw new OrchestrationError('locked', 'Workflow is locked')
  try {
    await assertFolderMutable(row.folderId, tx)
  } catch (error) {
    if (error instanceof FolderLockedError) {
      throw new OrchestrationError('locked', 'Workflow is locked by its containing folder')
    }
    throw error
  }
  return {
    state: {
      blocks: (normalized?.blocks ?? {}) as Record<string, BlockState>,
      edges: (normalized?.edges ?? []) as WorkflowState['edges'],
      loops: normalized?.loops ?? {},
      parallels: normalized?.parallels ?? {},
      variables: parseWorkflowVariables(row.variables) ?? {},
    },
    meta: { name: row.name, description: row.description ?? null },
  }
}

/** What a commit over an existing draft re-checks under the row lock. */
interface ExistingDraftCommit {
  scope: CommitScope
  plan: SourcePlan
  /** The draft the plan was evaluated against, and its fingerprint. */
  stored: StoredSource
  storedFingerprint: SourceFingerprint
  expectedFingerprint: string
  catalog: BlockCatalog
}

/**
 * Re-reads the draft under the row lock and refuses the write when the workflow was locked
 * (423) or its fingerprint moved off `expectedFingerprint` (409), then stores the submission's
 * source meta merged onto the one stored now. Returns the current draft.
 */
async function recheckAndWriteSourceMeta(
  tx: DbOrTx,
  args: ExistingDraftCommit
): Promise<StoredSource> {
  const { scope, plan, stored, catalog } = args
  const current = await loadMutableStoredSourceIn(tx, scope.workflowId)
  const fingerprint = isEqual(current, stored)
    ? args.storedFingerprint
    : fingerprintOf(current, catalog, plan.resources)
  if (fingerprint !== args.expectedFingerprint) throw new WorkflowSourceStaleError(fingerprint)
  await writeWorkflowSourceMeta(
    tx,
    scope.workflowId,
    mergeSourceMetaFromLock(
      await readWorkflowSourceMeta(tx, scope.workflowId),
      plan.lock,
      plan.compiled
    )
  )
  return current
}

/**
 * Existing blocks keep the positions stored at write time, so a canvas drag that landed during
 * the apply survives it.
 */
function mergeCurrentLayout(
  target: Record<string, BlockState>,
  current: Record<string, BlockState>
): Record<string, BlockState> {
  const merged: Record<string, BlockState> = {}
  for (const [id, block] of Object.entries(target)) {
    const stored = current[id]
    if (!stored) {
      merged[id] = block
      continue
    }
    const next: BlockState = {
      ...omit(block, ['height', 'layout']),
      position: stored.position,
      ...(stored.height !== undefined ? { height: stored.height } : {}),
      ...(stored.layout !== undefined ? { layout: stored.layout } : {}),
    }
    if (block.data) {
      next.data = {
        ...omit(block.data, ['width', 'height']),
        ...(stored.data?.width !== undefined ? { width: stored.data.width } : {}),
        ...(stored.data?.height !== undefined ? { height: stored.data.height } : {}),
      }
    }
    merged[id] = isEqual(next, block) ? block : next
  }
  return merged
}

/**
 * Writes the plan over an existing draft in one `replaceWorkflowNormalizedState` under the
 * workflow row lock. Inside the lock it re-checks the workflow lock and the fingerprint, keeps
 * current canvas positions for existing blocks, asserts the locked-block merge is the identity,
 * and stores the submission's source meta in the same transaction.
 */
export async function commitSourceReplace(args: ExistingDraftCommit): Promise<CommittedGraph> {
  const { scope, plan } = args
  await assertNoWithheldBlockType(
    { workspaceId: scope.workspaceId, subjectUserId: scope.subjectUserId },
    Object.values(plan.blocks)
  )
  return replaceWorkflowNormalizedState({
    workflowId: scope.workflowId,
    workspaceId: scope.workspaceId,
    attributedUserId: scope.subjectUserId,
    subjectUserId: scope.subjectUserId,
    state: async (tx) => {
      const current = await recheckAndWriteSourceMeta(tx, args)
      const next = {
        blocks: mergeCurrentLayout(plan.blocks, current.state.blocks),
        edges: plan.edges,
      }
      assertLockedBlocksPreserved(
        { blocks: current.state.blocks, edges: current.state.edges },
        next
      )
      return plan.variables === undefined ? next : { ...next, variables: plan.variables }
    },
  })
}

/**
 * Stores only the source meta of a graph no-op (new idents, order or comments), under the same
 * row lock and re-checks as {@link commitSourceReplace}, so it never lands on a draft that moved
 * or was locked meanwhile, and merges onto the source meta stored at write time.
 */
export async function commitSourceMeta(args: ExistingDraftCommit): Promise<void> {
  const { workflowId, workspaceId } = args.scope
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(
        and(
          eq(workflowTable.id, workflowId),
          eq(workflowTable.workspaceId, workspaceId),
          isNull(workflowTable.archivedAt)
        )
      )
      .limit(1)
      .for('update')
    if (!locked) throw new OrchestrationError('not_found', 'Workflow not found')
    await recheckAndWriteSourceMeta(tx, args)
  })
}

/**
 * Inserts a workflow created from source and its graph in one transaction: the row (with the
 * create path's folder, name-conflict and sort rules), the prepared graph under the caller's block
 * access, its variables and its source meta. A name taken in the folder is a 409; any failure rolls
 * the whole create back.
 */
export async function commitSourceCreate(args: {
  scope: CommitScope
  plan: SourcePlan
  folderId: string | null
}): Promise<CommittedGraph & { name: string }> {
  const { scope, plan } = args
  const { workspaceId, subjectUserId } = scope
  await assertNoWithheldBlockType({ workspaceId, subjectUserId }, Object.values(plan.blocks))
  const prepared = prepareWorkflowStateForPersistence({ blocks: plan.blocks, edges: plan.edges })
  const transition = await performCreateWorkflowTransition({
    id: scope.workflowId,
    userId: subjectUserId,
    workspaceId,
    name: plan.meta.name,
    description: plan.meta.description,
    folderId: args.folderId,
    writeGraph: async (tx, workflowId) => {
      await assertWorkflowGraphIdsUnclaimed(tx, workflowId, collectWorkflowGraphIds(prepared.state))
      const saved = await saveWorkflowToNormalizedTables(
        workflowId,
        { ...prepared.state, lastSaved: Date.now() } as WorkflowState,
        { workspaceId, subjectUserId },
        tx
      )
      if (!saved.success) {
        throw new WorkflowStatePersistenceError(saved.error ?? 'Unknown persistence failure')
      }
      if (plan.variables !== undefined) {
        await tx
          .update(workflowTable)
          .set({ variables: plan.variables })
          .where(eq(workflowTable.id, workflowId))
      }
      await writeWorkflowSourceMeta(tx, workflowId, plan.sourceMeta)
    },
  })
  requireWorkflowTransition(transition, 'Failed to create workflow')
  if (!transition.workflow) throw new Error('Successful workflow create returned no workflow')

  try {
    const { errors } = await extractAndPersistCustomTools(
      prepared.state,
      workspaceId,
      subjectUserId
    )
    if (errors.length > 0) {
      logger.warn('Some custom tools failed to persist', { workflowId: scope.workflowId, errors })
    }
  } catch (error) {
    logger.error('Failed to persist custom tools', { workflowId: scope.workflowId, error })
  }
  return { name: transition.workflow.name, state: prepared.state, warnings: prepared.warnings }
}

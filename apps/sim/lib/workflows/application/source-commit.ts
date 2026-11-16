import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { omit } from '@sim/utils/object'
import { type BlockCatalog, canonicalize, type SourceFingerprint } from '@sim/workflow-code'
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
  /** The draft the plan was evaluated against, and its fingerprint (the submission's base). */
  stored: StoredSource
  storedFingerprint: SourceFingerprint
  catalog: BlockCatalog
}

/**
 * A block's canvas geometry: what a drag or resize writes and the fingerprint ignores. Everything
 * else on a block is either in the fingerprint or preserved state the plan carries from `stored`.
 */
const LAYOUT_KEYS = ['position', 'height', 'layout'] as const
const LAYOUT_DATA_KEYS = ['width', 'height'] as const

function withoutLayout(block: BlockState): Omit<BlockState, (typeof LAYOUT_KEYS)[number]> {
  const rest = omit(block, [...LAYOUT_KEYS])
  return block.data ? { ...rest, data: omit(block.data, [...LAYOUT_DATA_KEYS]) } : rest
}

function withoutBlockLayout(source: StoredSource) {
  const blocks: Record<string, ReturnType<typeof withoutLayout>> = {}
  for (const [id, block] of Object.entries(source.state.blocks)) blocks[id] = withoutLayout(block)
  return { ...source, state: { ...source.state, blocks } }
}

/**
 * Re-reads the draft under the row lock and refuses the write when the workflow was locked
 * (423) or its fingerprint moved off `storedFingerprint` (409), then stores the submission's
 * source meta merged onto the one stored now. Returns the current draft.
 *
 * With `layoutOnly`, any change since `stored` other than canvas geometry is a 409 too, even one
 * the fingerprint ignores (a trigger's `triggerPath`, an inactive value, unknown `data`): the plan
 * carries those from `stored`, so writing it would silently revert a concurrent canvas edit. The
 * caller rebases by reading the source again; a drag alone is merged by {@link mergeConcurrentLayout}.
 */
async function recheckAndWriteSourceMeta(
  tx: DbOrTx,
  args: ExistingDraftCommit,
  options: { layoutOnly: boolean }
): Promise<StoredSource> {
  const { scope, plan, stored, catalog } = args
  const current = await loadMutableStoredSourceIn(tx, scope.workflowId)
  if (!isEqual(current, stored)) {
    const fingerprint = fingerprintOf(
      canonicalize(current.state, { catalog, meta: current.meta, resources: plan.resources })
    )
    if (fingerprint !== args.storedFingerprint) throw new WorkflowSourceStaleError(fingerprint)
    if (options.layoutOnly && !isEqual(withoutBlockLayout(current), withoutBlockLayout(stored))) {
      throw new WorkflowSourceStaleError(fingerprint)
    }
  }
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

/** `value` set on `record[key]`, or the key removed for `undefined`. */
function assignOrDelete<T extends object, K extends keyof T>(record: T, key: K, value: T[K]): void {
  if (value === undefined) delete record[key]
  else record[key] = value
}

/**
 * The plan's blocks with a canvas drag or resize that committed during the apply kept: a layout
 * field `current` holds differently from the evaluate-time `stored` is a concurrent edit, so it
 * wins over the plan's. Everything else is the plan's own layout, including the targeted layout
 * of a block the source moved into another container (its old position is in the wrong frame)
 * and the dimensions of a container the plan resized. With no concurrent drag `current` equals
 * `stored` and the result is the plan, exactly what a dry run reports.
 */
function mergeConcurrentLayout(
  target: Record<string, BlockState>,
  current: Record<string, BlockState>,
  stored: Record<string, BlockState>
): Record<string, BlockState> {
  const merged: Record<string, BlockState> = {}
  for (const [id, block] of Object.entries(target)) {
    const now = current[id]
    const before = stored[id]
    if (!now || !before || block.data?.parentId !== before.data?.parentId) {
      merged[id] = block
      continue
    }
    const next: BlockState = { ...block }
    for (const key of LAYOUT_KEYS) {
      if (!isEqual(now[key], before[key])) assignOrDelete(next, key, now[key])
    }
    if (block.data) {
      const data = { ...block.data }
      for (const key of LAYOUT_DATA_KEYS) {
        const resizedByPlan = !isEqual(block.data[key], before.data?.[key])
        if (!resizedByPlan && !isEqual(now.data?.[key], before.data?.[key])) {
          assignOrDelete(data, key, now.data?.[key])
        }
      }
      next.data = data
    }
    merged[id] = isEqual(next, block) ? block : next
  }
  return merged
}

/**
 * Writes the plan over an existing draft in one `replaceWorkflowNormalizedState` under the
 * workflow row lock. Inside the lock it re-checks the workflow lock, refuses (409) any change
 * since evaluation beyond canvas geometry, keeps a drag or resize that landed meanwhile, asserts
 * the locked-block merge is the identity, and stores the submission's source meta in the same
 * transaction.
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
      const current = await recheckAndWriteSourceMeta(tx, args, { layoutOnly: true })
      const next = {
        blocks: mergeConcurrentLayout(plan.blocks, current.state.blocks, args.stored.state.blocks),
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
    await recheckAndWriteSourceMeta(tx, args, { layoutOnly: false })
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

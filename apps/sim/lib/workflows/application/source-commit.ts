import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import {
  type BlockCatalog,
  canonicalize,
  type SourceFingerprint,
  setOrDelete,
} from '@sim/workflow-code'
import { BLOCK_LAYOUT_DATA_FIELDS, BLOCK_LAYOUT_FIELDS } from '@sim/workflow-code/layout'
import {
  loadWorkflowFromNormalizedTablesRaw,
  type RawNormalizedWorkflow,
} from '@sim/workflow-persistence/load'
import {
  readWorkflowSourceMeta,
  writeWorkflowSourceMeta,
} from '@sim/workflow-persistence/source-meta'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { requireMutableFolder } from '@/lib/workflows/application/mutability'
import {
  WorkflowSourceNameTakenError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import type { SourcePlan } from '@/lib/workflows/application/source-pipeline'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { assertLockedBlocksPreserved } from '@/lib/workflows/code/apply/locked'
import { type StoredSource, storedSourceFingerprint } from '@/lib/workflows/code/print-stored'
import { mergeSourceMetaFromLock } from '@/lib/workflows/code/source-lock'
import {
  isWorkflowNameUniqueViolation,
  performCreateWorkflowTransition,
  updateWorkflowRecord,
  workflowNameExistsInFolder,
} from '@/lib/workflows/orchestration'
import { assertNoWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'
import {
  type PreparedWorkflowState,
  prepareWorkflowStateForPersistence,
} from '@/lib/workflows/persistence/prepare-state'
import {
  assertWorkflowGraphIdsUnclaimed,
  collectWorkflowGraphIds,
  persistCustomToolsAfterCommit,
  replaceWorkflowNormalizedState,
  WorkflowStatePersistenceError,
} from '@/lib/workflows/persistence/replace-normalized-state'
import {
  fromRawNormalized,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'

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
 * Refuses a workflow created from source under a name already taken in its folder, as the create
 * would refuse it ({@link WorkflowSourceNameTakenError}): checked when the create is planned.
 */
export async function assertCreateNameFree(
  plan: SourcePlan,
  target: { workspaceId: string; folderId: string | null }
): Promise<void> {
  if (await workflowNameExistsInFolder({ ...target, name: plan.meta.name })) {
    throw new WorkflowSourceNameTakenError(plan.meta.name)
  }
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

/** The draft re-read under the row lock, and the folder the workflow is in. */
interface LockedDraft {
  current: StoredSource
  folderId: string | null
}

/**
 * The stored draft re-read under the row lock: blocks, edges and the row's variables and meta,
 * from `raw` when the caller already read the graph under that lock. Refuses (423) a workflow
 * locked, directly or by a folder above it, after the use case's `requireMutableWorkflow` ran:
 * locking a workflow updates this row, so it waits for the lock this transaction holds and cannot
 * slip in between the check and the write.
 */
async function loadMutableStoredSourceIn(
  tx: DbOrTx,
  workflowId: string,
  raw?: RawNormalizedWorkflow
): Promise<LockedDraft> {
  const loadGraph = async () => {
    const loaded = raw ?? (await loadWorkflowFromNormalizedTablesRaw(workflowId, tx))
    return loaded ? fromRawNormalized(workflowId, loaded, tx) : null
  }
  const [normalized, [row]] = await Promise.all([
    loadGraph(),
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
  await requireMutableFolder(row.folderId, tx, 'Workflow is locked by its containing folder')
  return {
    current: {
      state: {
        blocks: normalized?.blocks ?? {},
        edges: (normalized?.edges ?? []) as WorkflowState['edges'],
        loops: normalized?.loops ?? {},
        parallels: normalized?.parallels ?? {},
        variables: parseWorkflowVariables(row.variables) ?? {},
      },
      meta: { name: row.name, description: row.description ?? null },
    },
    folderId: row.folderId ?? null,
  }
}

/**
 * Gives the workflow the name and description its source declares, in the commit's transaction
 * after the freshness check: a rename since the read is already a 409, and a name taken in the
 * folder meanwhile, before the check or racing it, refuses the whole commit
 * ({@link WorkflowSourceNameTakenError}).
 */
async function writePlannedMeta(
  tx: DbOrTx,
  { scope, plan }: ExistingDraftCommit,
  { current, folderId }: LockedDraft
): Promise<void> {
  if (plan.metaChanged.length === 0) return
  // The name check is a SELECT: a rename committing meanwhile surfaces as the unique violation.
  const transition = await updateWorkflowRecord({
    tx,
    workflowId: scope.workflowId,
    workspaceId: scope.workspaceId,
    userId: scope.subjectUserId,
    currentName: current.meta.name,
    currentFolderId: folderId,
    ...(plan.metaChanged.includes('name') ? { name: plan.meta.name } : {}),
    ...(plan.metaChanged.includes('description')
      ? { description: plan.meta.description ?? null }
      : {}),
  }).catch((error: unknown) => {
    if (isWorkflowNameUniqueViolation(error)) throw new WorkflowSourceNameTakenError(plan.meta.name)
    throw error
  })
  if (!transition.success && transition.errorCode === 'conflict') {
    throw new WorkflowSourceNameTakenError(plan.meta.name)
  }
  requireWorkflowTransition(transition, 'Failed to rename workflow')
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
 * A block without its canvas layout: what a drag, resize or handle flip writes and the
 * fingerprint ignores. Everything else on a block is either in the fingerprint or preserved state
 * the plan carries from `stored`.
 */
function withoutLayout(block: BlockState): Omit<BlockState, (typeof BLOCK_LAYOUT_FIELDS)[number]> {
  const rest = omit(block, [...BLOCK_LAYOUT_FIELDS])
  return block.data ? { ...rest, data: omit(block.data, [...BLOCK_LAYOUT_DATA_FIELDS]) } : rest
}

/** `source` without canvas geometry, its edges in id order: the edges read has no ORDER BY. */
function withoutBlockLayout(source: StoredSource) {
  const blocks: Record<string, ReturnType<typeof withoutLayout>> = {}
  for (const [id, block] of Object.entries(source.state.blocks)) blocks[id] = withoutLayout(block)
  const edges = [...source.state.edges].sort((a, b) => compareStrings(a.id, b.id))
  return { ...source, state: { ...source.state, blocks, edges } }
}

/**
 * Re-reads the draft under the row lock and refuses the write when the workflow was locked
 * (423) or its fingerprint moved off `storedFingerprint` (409), then stores the submission's
 * source meta merged onto the one stored now, and the name and description it declares. Returns
 * the current draft.
 *
 * With `layoutOnly`, any change since `stored` other than canvas geometry is a 409 too, even one
 * the fingerprint ignores (a trigger's `triggerPath`, an inactive value, unknown `data`): the plan
 * carries those from `stored`, so writing it would silently revert a concurrent canvas edit. The
 * caller rebases by reading the source again; a drag alone is merged by {@link mergeConcurrentLayout}.
 */
async function recheckAndWriteSourceMeta(
  tx: DbOrTx,
  args: ExistingDraftCommit,
  options: { layoutOnly: boolean; raw?: RawNormalizedWorkflow }
): Promise<StoredSource> {
  const { scope, plan, stored, catalog } = args
  const locked = await loadMutableStoredSourceIn(tx, scope.workflowId, options.raw)
  const { current } = locked
  if (!isEqual(current, stored)) {
    const fingerprint = storedSourceFingerprint(
      canonicalize(current.state, { catalog, meta: current.meta, resources: plan.resources }),
      plan.resources
    )
    if (fingerprint !== args.storedFingerprint) {
      throw new WorkflowSourceStaleError(fingerprint, current.meta.name)
    }
    if (options.layoutOnly && !isEqual(withoutBlockLayout(current), withoutBlockLayout(stored))) {
      throw new WorkflowSourceStaleError(fingerprint, current.meta.name)
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
  await writePlannedMeta(tx, args, locked)
  return current
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
    for (const key of BLOCK_LAYOUT_FIELDS) {
      if (!isEqual(now[key], before[key])) setOrDelete(next, key, now[key])
    }
    if (block.data) {
      const data = { ...block.data }
      for (const key of BLOCK_LAYOUT_DATA_FIELDS) {
        const resizedByPlan = !isEqual(block.data[key], before.data?.[key])
        if (!resizedByPlan && !isEqual(now.data?.[key], before.data?.[key])) {
          setOrDelete(data, key, now.data?.[key])
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
 * the locked-block merge is the identity, and stores the submission's source meta, name and
 * description in the same transaction.
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
    state: async (tx, raw) => {
      const current = await recheckAndWriteSourceMeta(tx, args, { layoutOnly: true, raw })
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
 * Stores only the source meta, name and description of a graph no-op (new idents, order,
 * comments, a rename), under the same row lock and re-checks as {@link commitSourceReplace}, so
 * it never lands on a draft that moved or was locked meanwhile, and merges onto the source meta
 * stored at write time.
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
 * access, its variables and its source meta. A name taken in the folder is a 409
 * ({@link WorkflowSourceNameTakenError}); any failure rolls the whole create back.
 */
export async function commitSourceCreate(args: {
  scope: CommitScope
  plan: SourcePlan
  folderId: string | null
  /** Runs last inside the create's transaction, so its writes commit with the workflow's. */
  withinCreate?: (tx: DbTransaction, workflowId: string) => Promise<void>
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
      await args.withinCreate?.(tx, workflowId)
    },
  })
  if (!transition.success && transition.conflict === 'name') {
    throw new WorkflowSourceNameTakenError(plan.meta.name)
  }
  requireWorkflowTransition(transition, 'Failed to create workflow')
  if (!transition.workflow) throw new Error('Successful workflow create returned no workflow')

  const toolWarnings = await persistCustomToolsAfterCommit(
    prepared.state,
    workspaceId,
    subjectUserId,
    { workflowId: scope.workflowId }
  )
  return {
    name: transition.workflow.name,
    state: prepared.state,
    warnings: [...prepared.warnings, ...toolWarnings],
  }
}

import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import type { BlockCatalog, SourceFingerprint } from '@sim/workflow-code'
import { readWorkflowCodeMeta, writeWorkflowCodeMeta } from '@sim/workflow-persistence/code-meta'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { WorkflowSourceStaleError } from '@/lib/workflows/application/source-error'
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import type { SourcePlan } from '@/lib/workflows/code/apply/evaluate'
import { fingerprintOf, type StoredSource } from '@/lib/workflows/code/apply/print'
import { assertProtectedBlocksPreserved } from '@/lib/workflows/code/apply/protected'
import { mergeCodeMetaFromLock } from '@/lib/workflows/code/source-lock'
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

/** The stored draft re-read under the row lock: blocks, edges and the row's variables and meta. */
async function loadStoredSourceIn(tx: DbOrTx, workflowId: string): Promise<StoredSource> {
  const [normalized, [row]] = await Promise.all([
    loadWorkflowFromNormalizedTables(workflowId, tx),
    tx
      .select({
        name: workflowTable.name,
        description: workflowTable.description,
        variables: workflowTable.variables,
      })
      .from(workflowTable)
      .where(and(eq(workflowTable.id, workflowId), isNull(workflowTable.archivedAt)))
      .limit(1),
  ])
  if (!row) throw new OrchestrationError('not_found', 'Workflow not found')
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
 * workflow row lock. Inside the lock it re-reads the draft and answers 409 when its fingerprint
 * moved off `baseFingerprint`, keeps current canvas positions for existing blocks, asserts the
 * protected-block merge is the identity, and stores the submission's `code_meta` in the same
 * transaction.
 */
export async function commitSourceReplace(args: {
  scope: CommitScope
  plan: SourcePlan
  /** The draft the plan was evaluated against, and its fingerprint. */
  stored: StoredSource
  storedFingerprint: SourceFingerprint
  baseFingerprint: string
  catalog: BlockCatalog
}): Promise<CommittedGraph> {
  const { scope, plan, stored, catalog } = args
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
      const current = await loadStoredSourceIn(tx, scope.workflowId)
      const fingerprint = isEqual(current, stored)
        ? args.storedFingerprint
        : fingerprintOf(current, catalog, plan.resources)
      if (fingerprint !== args.baseFingerprint) throw new WorkflowSourceStaleError(fingerprint)
      const next = {
        blocks: mergeCurrentLayout(plan.blocks, current.state.blocks),
        edges: plan.edges,
      }
      assertProtectedBlocksPreserved(
        { blocks: current.state.blocks, edges: current.state.edges },
        next
      )
      await writeWorkflowCodeMeta(
        tx,
        scope.workflowId,
        mergeCodeMetaFromLock(
          await readWorkflowCodeMeta(tx, scope.workflowId),
          plan.lock,
          plan.compiled
        )
      )
      return plan.variables === undefined ? next : { ...next, variables: plan.variables }
    },
  })
}

/**
 * Inserts a workflow created from source and its graph in one transaction: the row (with the
 * create path's folder, name-conflict and sort rules), the prepared graph under the caller's block
 * access, its variables and its `code_meta`. A name taken in the folder is a 409; any failure rolls
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
      await writeWorkflowCodeMeta(tx, workflowId, plan.codeMeta)
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

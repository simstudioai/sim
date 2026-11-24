import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { isRecordLike, sortObjectKeysDeep, toRecord } from '@sim/utils/object'
import { eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkflowDiffSummary, omitPresentationChanges } from '@/lib/workflows/comparison'
import {
  type PublicWorkflowDiffSummary,
  redactWorkflowDiffSummary,
} from '@/lib/workflows/comparison/redact'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/extractor'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * The same policy public version reads apply: credentials, passwords and opaque values are
 * cleared, while env-var references and workspace bindings stay so the diff stays meaningful.
 */
const BASELINE_SANITIZATION = {
  preserveEnvVars: true,
  preserveWorkspaceBindings: true,
  redactOpaqueCredentialInputs: true,
} as const

/** `blockId` → `subBlockId` → a salted hash of a value sanitization cleared. */
type ClearedFieldHashes = Record<string, Record<string, string>>

/**
 * What a baseline records: the sanitized graph, plus a hash of each value sanitization cleared,
 * so switching a block's credential is a change even though the credential itself is never kept.
 */
export interface BaselineGraph {
  state: WorkflowState
  clearedFields: ClearedFieldHashes
}

/** A baseline with the workflow `updatedAt` it was read at, which orders baselines. */
export interface BaselineSnapshot extends BaselineGraph {
  workflowUpdatedAt: Date
}

function toWorkflowState(value: unknown): WorkflowState {
  if (!isRecordLike(value) || !isRecordLike(value.blocks) || !Array.isArray(value.edges)) {
    throw new OrchestrationError('internal', 'A build-notes baseline is not a workflow graph')
  }
  return {
    blocks: value.blocks as WorkflowState['blocks'],
    edges: value.edges as WorkflowState['edges'],
    loops: toRecord(value.loops) as WorkflowState['loops'],
    parallels: toRecord(value.parallels) as WorkflowState['parallels'],
    variables: toRecord(value.variables) as WorkflowState['variables'],
    lastSaved: 0,
  }
}

/** A block's values sanitization may clear: each subblock's value, and each `data` entry as `data.<key>`. */
function withheldCandidates(block: unknown): Record<string, unknown> {
  if (!isRecordLike(block)) return {}
  const values: Record<string, unknown> = {}
  for (const [id, subBlock] of Object.entries(toRecord(block.subBlocks))) {
    values[id] = isRecordLike(subBlock) ? subBlock.value : undefined
  }
  for (const [key, value] of Object.entries(toRecord(block.data))) values[`data.${key}`] = value
  return values
}

/** Hashes each subblock value the sanitized graph no longer carries, salted by its place. */
function clearedFieldHashes(
  workflowId: string,
  stored: WorkflowState,
  sanitized: WorkflowState
): ClearedFieldHashes {
  const hashes: ClearedFieldHashes = {}
  for (const [blockId, block] of Object.entries(stored.blocks)) {
    const kept = withheldCandidates(sanitized.blocks[blockId])
    for (const [field, value] of Object.entries(withheldCandidates(block))) {
      if (value === undefined || value === null || value === '') continue
      if (JSON.stringify(kept[field]) === JSON.stringify(value)) continue
      hashes[blockId] ??= {}
      hashes[blockId][field] = sha256Hex(
        `${workflowId}\u0000${blockId}\u0000${field}\u0000${JSON.stringify(value)}`
      )
    }
  }
  return hashes
}

/** The graph a baseline holds: the stored workflow, sanitized, with no save clock. */
function baselineGraph(workflowId: string, stored: WorkflowState): BaselineGraph {
  const state = toWorkflowState({
    ...sanitizeWorkflowForSharing(stored, BASELINE_SANITIZATION),
    lastSaved: 0,
  })
  return { state, clearedFields: clearedFieldHashes(workflowId, stored, state) }
}

/**
 * The workflow as it is stored now, as a baseline, and the `updatedAt` it was read at, both from
 * one snapshot: inside `executor` when one is passed (a write transaction sees its own write),
 * otherwise a repeatable-read transaction of its own.
 */
export async function loadCurrentBaselineState(
  workflowId: string,
  executor?: DbOrTx
): Promise<BaselineSnapshot> {
  const read = async (tx: DbOrTx): Promise<BaselineSnapshot> => {
    const snapshot = await loadWorkflowDeploymentSnapshot(workflowId, tx)
    const [row] = await tx
      .select({ updatedAt: workflow.updatedAt })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    if (!snapshot || !row) throw new OrchestrationError('not_found', 'Workflow not found')
    return { ...baselineGraph(workflowId, snapshot), workflowUpdatedAt: row.updatedAt }
  }
  if (executor) return read(executor)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    return read(tx)
  })
}

/** The baseline file's text: the graph and the withheld-value hashes, keys sorted, so equal baselines serialize identically. */
export function serializeBaseline(baseline: BaselineGraph): string {
  return `${JSON.stringify(
    sortObjectKeysDeep({ ...baseline.state, clearedFields: baseline.clearedFields }),
    null,
    2
  )}\n`
}

/**
 * Reads a baseline file back. Throws `internal` when the text is not JSON or not a workflow
 * graph; malformed withheld-value hashes are dropped rather than trusted.
 */
export function parseBaseline(content: string): BaselineGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new OrchestrationError('internal', 'A build-notes baseline is not valid JSON')
  }
  const clearedFields: ClearedFieldHashes = {}
  if (isRecordLike(parsed)) {
    for (const [blockId, fields] of Object.entries(toRecord(parsed.clearedFields))) {
      for (const [field, hash] of Object.entries(toRecord(fields))) {
        if (typeof hash !== 'string') continue
        clearedFields[blockId] ??= {}
        clearedFields[blockId][field] = hash
      }
    }
  }
  return { state: toWorkflowState(parsed), clearedFields }
}

/** Fields whose cleared value (a credential, a password) differs, without revealing either. */
function clearedFieldChanges(
  baseline: BaselineGraph,
  current: BaselineGraph
): { blockId: string; field: string }[] {
  const changes: { blockId: string; field: string }[] = []
  const blockIds = new Set([
    ...Object.keys(baseline.clearedFields),
    ...Object.keys(current.clearedFields),
  ])
  for (const blockId of blockIds) {
    if (!baseline.state.blocks[blockId] || !current.state.blocks[blockId]) continue
    const before = baseline.clearedFields[blockId] ?? {}
    const after = current.clearedFields[blockId] ?? {}
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[field] !== after[field]) changes.push({ blockId, field })
    }
  }
  return changes
}

/**
 * What changed from the baseline to the current graph, ignoring layout-only moves. A block whose
 * credential or other cleared value changed is listed in `clearedFieldChanges`, by field only.
 */
export function diffFromBaseline(
  baseline: BaselineGraph,
  current: BaselineGraph
): {
  hasChanges: boolean
  diff: PublicWorkflowDiffSummary
  clearedFieldChanges: { blockId: string; field: string }[]
} {
  const summary = omitPresentationChanges(
    generateWorkflowDiffSummary(current.state, baseline.state)
  )
  const cleared = clearedFieldChanges(baseline, current)
  return {
    hasChanges: summary.hasChanges || cleared.length > 0,
    diff: redactWorkflowDiffSummary(summary, baseline.state, current.state),
    clearedFieldChanges: cleared,
  }
}

import { workflow, workflowBlocks, workflowEdges, workflowSubflows } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import type { WorkflowEvalTest } from '@/lib/api/contracts/workflow-evals'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import type { DbOrTx } from '@/lib/db/types'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import type { WorkflowState } from '@/lib/logs/types'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'

export const MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS = 1_001
export const MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES = 10 * 1024 * 1024
export const MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_BYTES = 64 * 1024 * 1024
export const MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET = 5_000
export const MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET = 20_000
export const MAX_WORKFLOW_EVAL_SNAPSHOT_SUBFLOWS_PER_TARGET = 5_000
export const MAX_WORKFLOW_EVAL_SNAPSHOT_ROWS_PER_TARGET = 25_000
export const MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_ROWS = 100_000

const STATE_HASH_PATTERN = /^[a-f0-9]{64}$/

interface WorkflowTargetPreflightRow extends Record<string, unknown> {
  workflow_id: string
  workspace_id: string | null
  archived_at: Date | null
  workflow_bytes: number | string
  block_count: number | string
  block_bytes: number | string
  edge_count: number | string
  edge_bytes: number | string
  subflow_count: number | string
  subflow_bytes: number | string
}

interface ParsedWorkflowTargetPreflight {
  workflowId: string
  blockCount: number
  edgeCount: number
  subflowCount: number
  byteCount: number
}

export type WorkflowEvalSnapshotTargetErrorCode =
  | 'invalid_subject_workflow'
  | 'too_many_targets'
  | 'missing_workflow'
  | 'archived_workflow'
  | 'cross_workspace_workflow'
  | 'invalid_preflight_metadata'
  | 'target_row_limit_exceeded'
  | 'total_row_limit_exceeded'
  | 'target_byte_limit_exceeded'
  | 'total_byte_limit_exceeded'
  | 'missing_draft_state'
  | 'invalid_draft_state'
  | 'invalid_error_block_id'
  | 'invalid_mock_block_id'
  | 'inconsistent_draft_state'
  | 'invalid_snapshot_result'

export class WorkflowEvalSnapshotTargetError extends Error {
  constructor(
    readonly code: WorkflowEvalSnapshotTargetErrorCode,
    message: string,
    readonly workflowId?: string
  ) {
    super(message)
    this.name = 'WorkflowEvalSnapshotTargetError'
  }
}

export interface WorkflowEvalSnapshotTarget {
  workflowId: string
  snapshotId: string
  stateHash: string
  isSubject: boolean
}

interface CaptureWorkflowEvalSnapshotTargetsInput {
  tx: DbOrTx
  workspaceId: string
  subjectWorkflowId: string
  tests: readonly WorkflowEvalTest[]
}

function deriveTargetWorkflowIds(
  subjectWorkflowId: string,
  tests: readonly WorkflowEvalTest[]
): string[] {
  if (subjectWorkflowId.trim().length === 0) {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_subject_workflow',
      'Eval subject workflow ID must not be empty'
    )
  }

  const targetIds = new Set<string>([subjectWorkflowId])
  for (const test of tests) {
    if (test.evaluator.type === 'workflow') {
      targetIds.add(test.evaluator.workflowId)
    }
  }

  if (targetIds.size > MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS) {
    throw new WorkflowEvalSnapshotTargetError(
      'too_many_targets',
      `Eval snapshot target count exceeds ${MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS}`
    )
  }
  return [...targetIds].sort()
}

function parseSafeInteger(value: number | string, label: string, workflowId: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_preflight_metadata',
      `Workflow ${workflowId} has invalid ${label} preflight metadata`,
      workflowId
    )
  }
  return parsed
}

function parsePreflightRow(row: WorkflowTargetPreflightRow): ParsedWorkflowTargetPreflight {
  const workflowId = row.workflow_id
  const blockCount = parseSafeInteger(row.block_count, 'block count', workflowId)
  const edgeCount = parseSafeInteger(row.edge_count, 'edge count', workflowId)
  const subflowCount = parseSafeInteger(row.subflow_count, 'subflow count', workflowId)
  const workflowBytes = parseSafeInteger(row.workflow_bytes, 'workflow byte count', workflowId)
  const blockBytes = parseSafeInteger(row.block_bytes, 'block byte count', workflowId)
  const edgeBytes = parseSafeInteger(row.edge_bytes, 'edge byte count', workflowId)
  const subflowBytes = parseSafeInteger(row.subflow_bytes, 'subflow byte count', workflowId)
  const byteCount = workflowBytes + blockBytes + edgeBytes + subflowBytes

  if (!Number.isSafeInteger(byteCount)) {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_preflight_metadata',
      `Workflow ${workflowId} preflight byte count exceeds the safe integer range`,
      workflowId
    )
  }
  if (blockCount > MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET) {
    throw new WorkflowEvalSnapshotTargetError(
      'target_row_limit_exceeded',
      `Workflow ${workflowId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET} block snapshot limit`,
      workflowId
    )
  }
  if (edgeCount > MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET) {
    throw new WorkflowEvalSnapshotTargetError(
      'target_row_limit_exceeded',
      `Workflow ${workflowId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET} edge snapshot limit`,
      workflowId
    )
  }
  if (subflowCount > MAX_WORKFLOW_EVAL_SNAPSHOT_SUBFLOWS_PER_TARGET) {
    throw new WorkflowEvalSnapshotTargetError(
      'target_row_limit_exceeded',
      `Workflow ${workflowId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_SUBFLOWS_PER_TARGET} subflow snapshot limit`,
      workflowId
    )
  }
  if (blockCount + edgeCount + subflowCount > MAX_WORKFLOW_EVAL_SNAPSHOT_ROWS_PER_TARGET) {
    throw new WorkflowEvalSnapshotTargetError(
      'target_row_limit_exceeded',
      `Workflow ${workflowId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_ROWS_PER_TARGET} total row snapshot limit`,
      workflowId
    )
  }
  if (byteCount > MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES) {
    throw new WorkflowEvalSnapshotTargetError(
      'target_byte_limit_exceeded',
      `Workflow ${workflowId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES} byte snapshot limit`,
      workflowId
    )
  }

  return { workflowId, blockCount, edgeCount, subflowCount, byteCount }
}

async function preflightTargetWorkflows({
  tx,
  workspaceId,
  targetIds,
}: {
  tx: DbOrTx
  workspaceId: string
  targetIds: string[]
}): Promise<Map<string, ParsedWorkflowTargetPreflight>> {
  const targetIdList = sql.join(
    targetIds.map((targetId) => sql`${targetId}`),
    sql`, `
  )
  const rows = await tx.execute<WorkflowTargetPreflightRow>(sql`
    SELECT
      ${workflow.id} AS workflow_id,
      ${workflow.workspaceId} AS workspace_id,
      ${workflow.archivedAt} AS archived_at,
      octet_length(COALESCE(${workflow.variables}, '{}'::json)::text)::bigint AS workflow_bytes,
      block_stats.row_count AS block_count,
      block_stats.row_bytes AS block_bytes,
      edge_stats.row_count AS edge_count,
      edge_stats.row_bytes AS edge_bytes,
      subflow_stats.row_count AS subflow_count,
      subflow_stats.row_bytes AS subflow_bytes
    FROM ${workflow}
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::bigint AS row_count,
        COALESCE(SUM(octet_length(to_jsonb(bounded_blocks)::text)), 0)::bigint AS row_bytes
      FROM (
        SELECT target_blocks.*
        FROM ${workflowBlocks} AS target_blocks
        WHERE target_blocks.workflow_id = ${workflow.id}
        LIMIT ${MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET + 1}
      ) AS bounded_blocks
    ) AS block_stats
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::bigint AS row_count,
        COALESCE(SUM(octet_length(to_jsonb(bounded_edges)::text)), 0)::bigint AS row_bytes
      FROM (
        SELECT target_edges.*
        FROM ${workflowEdges} AS target_edges
        WHERE target_edges.workflow_id = ${workflow.id}
        LIMIT ${MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET + 1}
      ) AS bounded_edges
    ) AS edge_stats
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)::bigint AS row_count,
        COALESCE(SUM(octet_length(to_jsonb(bounded_subflows)::text)), 0)::bigint AS row_bytes
      FROM (
        SELECT target_subflows.*
        FROM ${workflowSubflows} AS target_subflows
        WHERE target_subflows.workflow_id = ${workflow.id}
        LIMIT ${MAX_WORKFLOW_EVAL_SNAPSHOT_SUBFLOWS_PER_TARGET + 1}
      ) AS bounded_subflows
    ) AS subflow_stats
    WHERE ${workflow.id} IN (${targetIdList})
    LIMIT ${MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS}
  `)

  const rowsById = new Map(rows.map((row) => [row.workflow_id, row]))
  const missingId = targetIds.find((targetId) => !rowsById.has(targetId))
  if (missingId) {
    throw new WorkflowEvalSnapshotTargetError(
      'missing_workflow',
      `Eval snapshot target workflow ${missingId} was not found`,
      missingId
    )
  }

  for (const targetId of targetIds) {
    const row = rowsById.get(targetId)
    if (!row) {
      throw new Error(`Missing preflight row for workflow ${targetId}`)
    }
    if (row.archived_at !== null) {
      throw new WorkflowEvalSnapshotTargetError(
        'archived_workflow',
        `Eval snapshot target workflow ${targetId} is archived`,
        targetId
      )
    }
    if (row.workspace_id !== workspaceId) {
      throw new WorkflowEvalSnapshotTargetError(
        'cross_workspace_workflow',
        `Eval snapshot target workflow ${targetId} does not belong to workspace ${workspaceId}`,
        targetId
      )
    }
  }

  const parsedRows = new Map<string, ParsedWorkflowTargetPreflight>()
  let totalRows = 0
  let totalBytes = 0
  for (const targetId of targetIds) {
    const row = rowsById.get(targetId)
    if (!row) {
      throw new Error(`Missing validated preflight row for workflow ${targetId}`)
    }
    const parsed = parsePreflightRow(row)
    totalRows += parsed.blockCount + parsed.edgeCount + parsed.subflowCount
    totalBytes += parsed.byteCount
    if (!Number.isSafeInteger(totalRows) || totalRows > MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_ROWS) {
      throw new WorkflowEvalSnapshotTargetError(
        'total_row_limit_exceeded',
        `Eval snapshot targets exceed the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_ROWS} total row limit`
      )
    }
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_BYTES) {
      throw new WorkflowEvalSnapshotTargetError(
        'total_byte_limit_exceeded',
        `Eval snapshot targets exceed the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_BYTES} total byte limit`
      )
    }
    parsedRows.set(targetId, parsed)
  }

  return parsedRows
}

function assertDraftStateStructure(
  workflowId: string,
  state: WorkflowState,
  preflight: ParsedWorkflowTargetPreflight
): void {
  const parsed = workflowStateSchema.strict().safeParse(state)
  if (!parsed.success) {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_draft_state',
      `Workflow ${workflowId} draft state is invalid: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`,
      workflowId
    )
  }
  if (!state.loops || !state.parallels || !state.variables || typeof state.lastSaved !== 'number') {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_draft_state',
      `Workflow ${workflowId} draft state is missing normalized state fields`,
      workflowId
    )
  }

  const blockEntries = Object.entries(state.blocks)
  const edges = state.edges
  const loopEntries = Object.entries(state.loops ?? {})
  const parallelEntries = Object.entries(state.parallels ?? {})
  const subflowEntries = [...loopEntries, ...parallelEntries]

  if (
    blockEntries.length !== preflight.blockCount ||
    edges.length !== preflight.edgeCount ||
    subflowEntries.length !== preflight.subflowCount
  ) {
    throw new WorkflowEvalSnapshotTargetError(
      'inconsistent_draft_state',
      `Workflow ${workflowId} draft row counts changed during snapshot capture`,
      workflowId
    )
  }

  const blockIds = new Set(blockEntries.map(([blockId]) => blockId))
  for (const [blockId, block] of blockEntries) {
    if (block.id !== blockId) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_draft_state',
        `Workflow ${workflowId} block key ${blockId} does not match block ID ${block.id}`,
        workflowId
      )
    }
  }

  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id) || !blockIds.has(edge.source) || !blockIds.has(edge.target)) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_draft_state',
        `Workflow ${workflowId} contains duplicate or disconnected edge ${edge.id}`,
        workflowId
      )
    }
    edgeIds.add(edge.id)
  }

  const subflowIds = new Set<string>()
  for (const [subflowId, subflow] of subflowEntries) {
    if (subflowIds.has(subflowId) || subflow.id !== subflowId) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_draft_state',
        `Workflow ${workflowId} contains duplicate or mismatched subflow ${subflowId}`,
        workflowId
      )
    }
    if (subflow.nodes.some((blockId) => !blockIds.has(blockId))) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_draft_state',
        `Workflow ${workflowId} subflow ${subflowId} references a missing block`,
        workflowId
      )
    }
    subflowIds.add(subflowId)
  }
}

function assertErrorBlockIdsExist(
  workflowId: string,
  state: WorkflowState,
  tests: readonly WorkflowEvalTest[]
): void {
  for (const test of tests) {
    const missingBlockId = test.errorBlockIds.find((blockId) => !state.blocks[blockId])
    if (missingBlockId) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_error_block_id',
        `Eval test ${test.id} errorBlockIds references missing subject block ${missingBlockId}`,
        workflowId
      )
    }
  }
}

function assertMockBlockIdsExist(
  workflowId: string,
  state: WorkflowState,
  tests: readonly WorkflowEvalTest[]
): void {
  for (const test of tests) {
    const missingBlockId = test.mocks?.find((mock) => !state.blocks[mock.blockId])?.blockId
    if (missingBlockId) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_mock_block_id',
        `Eval test ${test.id} mocks missing subject block ${missingBlockId}`,
        workflowId
      )
    }
  }
}

function getSerializedStateBytes(workflowId: string, state: WorkflowState): number {
  let serialized: string
  try {
    serialized = JSON.stringify(state)
  } catch (error) {
    throw new WorkflowEvalSnapshotTargetError(
      'invalid_draft_state',
      `Workflow ${workflowId} draft state cannot be serialized: ${getErrorMessage(error)}`,
      workflowId
    )
  }
  return Buffer.byteLength(serialized, 'utf8')
}

/**
 * Captures one immutable draft snapshot for the subject and every distinct workflow judge.
 * The caller owns the transaction so target validation, state reads, snapshot upserts, and
 * Eval target-row inserts can commit or roll back as one admission unit.
 */
export async function captureWorkflowEvalSnapshotTargets({
  tx,
  workspaceId,
  subjectWorkflowId,
  tests,
}: CaptureWorkflowEvalSnapshotTargetsInput): Promise<WorkflowEvalSnapshotTarget[]> {
  const targetIds = deriveTargetWorkflowIds(subjectWorkflowId, tests)
  const preflightRows = await preflightTargetWorkflows({ tx, workspaceId, targetIds })
  const targets: WorkflowEvalSnapshotTarget[] = []
  let totalSerializedBytes = 0

  for (const targetId of targetIds) {
    const preflight = preflightRows.get(targetId)
    if (!preflight) {
      throw new Error(`Missing parsed preflight row for workflow ${targetId}`)
    }
    const state = await loadWorkflowDeploymentSnapshot(targetId, tx)
    if (!state) {
      throw new WorkflowEvalSnapshotTargetError(
        'missing_draft_state',
        `Workflow ${targetId} has no normalized draft state`,
        targetId
      )
    }
    assertDraftStateStructure(targetId, state, preflight)
    if (targetId === subjectWorkflowId) {
      assertErrorBlockIdsExist(targetId, state, tests)
      assertMockBlockIdsExist(targetId, state, tests)
    }

    const serializedBytes = getSerializedStateBytes(targetId, state)
    if (serializedBytes > MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES) {
      throw new WorkflowEvalSnapshotTargetError(
        'target_byte_limit_exceeded',
        `Workflow ${targetId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES} byte snapshot limit after serialization`,
        targetId
      )
    }
    totalSerializedBytes += serializedBytes
    if (
      !Number.isSafeInteger(totalSerializedBytes) ||
      totalSerializedBytes > MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_BYTES
    ) {
      throw new WorkflowEvalSnapshotTargetError(
        'total_byte_limit_exceeded',
        `Eval snapshot targets exceed the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_BYTES} total byte limit after serialization`
      )
    }

    const snapshotResult = await snapshotService.createExactSnapshotWithDeduplication(
      targetId,
      state,
      tx
    )
    const snapshot = snapshotResult.snapshot
    if (
      snapshot.id.length === 0 ||
      snapshot.workflowId !== targetId ||
      !STATE_HASH_PATTERN.test(snapshot.stateHash)
    ) {
      throw new WorkflowEvalSnapshotTargetError(
        'invalid_snapshot_result',
        `Workflow ${targetId} snapshot service returned invalid metadata`,
        targetId
      )
    }
    targets.push({
      workflowId: targetId,
      snapshotId: snapshot.id,
      stateHash: snapshot.stateHash,
      isSubject: targetId === subjectWorkflowId,
    })
  }

  return targets
}

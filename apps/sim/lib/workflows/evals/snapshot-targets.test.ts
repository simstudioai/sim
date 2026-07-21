/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateSnapshot, mockLoadWorkflowDeploymentSnapshot } = vi.hoisted(() => ({
  mockCreateSnapshot: vi.fn(),
  mockLoadWorkflowDeploymentSnapshot: vi.fn(),
}))

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { createExactSnapshotWithDeduplication: mockCreateSnapshot },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowDeploymentSnapshot: mockLoadWorkflowDeploymentSnapshot,
}))

import type { WorkflowEvalTest } from '@/lib/api/contracts/workflow-evals'
import type { DbOrTx } from '@/lib/db/types'
import type { WorkflowState } from '@/lib/logs/types'
import {
  captureWorkflowEvalSnapshotTargets,
  MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET,
  MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET,
  MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES,
  MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_ROWS,
  WorkflowEvalSnapshotTargetError,
} from '@/lib/workflows/evals/snapshot-targets'

const WORKSPACE_ID = 'workspace-1'
const SUBJECT_ID = 'workflow-subject'
const STATE_HASH = 'a'.repeat(64)

interface PreflightRowOverrides {
  workspace_id?: string | null
  archived_at?: Date | null
  workflow_bytes?: number | string
  block_count?: number | string
  block_bytes?: number | string
  edge_count?: number | string
  edge_bytes?: number | string
  subflow_count?: number | string
  subflow_bytes?: number | string
}

interface MockSqlQuery {
  toSQL(): { sql: string; params: unknown[] }
}

function preflightRow(workflowId: string, overrides: PreflightRowOverrides = {}) {
  return {
    workflow_id: workflowId,
    workspace_id: WORKSPACE_ID,
    archived_at: null,
    workflow_bytes: 32,
    block_count: 1,
    block_bytes: 256,
    edge_count: 0,
    edge_bytes: 0,
    subflow_count: 0,
    subflow_bytes: 0,
    ...overrides,
  }
}

function createTx(rows: ReturnType<typeof preflightRow>[]) {
  const execute = vi.fn().mockResolvedValue(rows)
  return { tx: { execute } as unknown as DbOrTx, execute }
}

function workflowTest(testId: string, workflowId: string): WorkflowEvalTest {
  return {
    id: testId,
    name: testId,
    input: {},
    errorBlockIds: ['start'],
    evaluator: {
      type: 'workflow',
      workflowId,
      inputMappings: [],
      scoreOutput: { blockId: 'score', path: '' },
    },
  }
}

function codeTest(testId: string): WorkflowEvalTest {
  return {
    id: testId,
    name: testId,
    input: {},
    errorBlockIds: ['start'],
    evaluator: { type: 'code', code: 'return true' },
  }
}

function draftState(value = 'ok'): WorkflowState {
  return {
    blocks: {
      start: {
        id: 'start',
        type: 'starter',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {
      fixture: {
        id: 'fixture',
        name: 'Fixture',
        type: 'string',
        value,
      },
    },
    lastSaved: 1,
  }
}

describe('captureWorkflowEvalSnapshotTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadWorkflowDeploymentSnapshot.mockImplementation(async () => draftState())
    mockCreateSnapshot.mockImplementation(async (workflowId: string, state: WorkflowState) => ({
      snapshot: {
        id: `snapshot-${workflowId}`,
        workflowId,
        stateHash: STATE_HASH,
        stateData: state,
        createdAt: '2026-07-17T00:00:00.000Z',
      },
      isNew: true,
    }))
  })

  it('deduplicates and globally orders the subject and workflow judges', async () => {
    const judgeId = 'workflow-judge'
    const { tx, execute } = createTx([preflightRow(judgeId), preflightRow(SUBJECT_ID)])

    const result = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [
        workflowTest('self-judge', SUBJECT_ID),
        workflowTest('judge-1', judgeId),
        workflowTest('judge-2', judgeId),
        codeTest('code'),
      ],
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockLoadWorkflowDeploymentSnapshot.mock.calls.map(([workflowId]) => workflowId)).toEqual(
      [judgeId, SUBJECT_ID]
    )
    expect(mockLoadWorkflowDeploymentSnapshot.mock.calls.every((call) => call[1] === tx)).toBe(true)
    expect(mockCreateSnapshot).toHaveBeenCalledTimes(2)
    expect(mockCreateSnapshot.mock.calls.every((call) => call[2] === tx)).toBe(true)
    expect(result).toEqual([
      {
        workflowId: judgeId,
        snapshotId: `snapshot-${judgeId}`,
        stateHash: STATE_HASH,
        isSubject: false,
      },
      {
        workflowId: SUBJECT_ID,
        snapshotId: `snapshot-${SUBJECT_ID}`,
        stateHash: STATE_HASH,
        isSubject: true,
      },
    ])
  })

  it('caps every preflight aggregate at its row limit plus one', async () => {
    const { tx, execute } = createTx([preflightRow(SUBJECT_ID)])

    await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [],
    })

    const query = execute.mock.calls[0]?.[0] as MockSqlQuery | undefined
    if (!query) throw new Error('Expected a snapshot preflight query')
    const compiled = query.toSQL()

    expect(compiled.sql.match(/CROSS JOIN LATERAL/g)).toHaveLength(3)
    expect(
      compiled.params.filter((param) => param === MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET + 1)
    ).toHaveLength(2)
    expect(compiled.params).toContain(MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET + 1)
  })

  it('rejects per-target row and byte bounds before loading draft payloads', async () => {
    const boundedFailures = [
      {
        row: preflightRow(SUBJECT_ID, {
          block_count: MAX_WORKFLOW_EVAL_SNAPSHOT_BLOCKS_PER_TARGET + 1,
        }),
        code: 'target_row_limit_exceeded',
      },
      {
        row: preflightRow(SUBJECT_ID, {
          workflow_bytes: MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES + 1,
        }),
        code: 'target_byte_limit_exceeded',
      },
    ] as const

    for (const failure of boundedFailures) {
      vi.clearAllMocks()
      const { tx } = createTx([failure.row])
      const error = await captureWorkflowEvalSnapshotTargets({
        tx,
        workspaceId: WORKSPACE_ID,
        subjectWorkflowId: SUBJECT_ID,
        tests: [],
      }).catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
      expect(error).toMatchObject({ code: failure.code })
      expect(mockLoadWorkflowDeploymentSnapshot).not.toHaveBeenCalled()
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
    }
  })

  it('rejects total row and byte bounds before loading any target payload', async () => {
    const judgeIds = Array.from({ length: 6 }, (_, index) => `workflow-judge-${index}`)
    const tests = judgeIds.map((workflowId, index) => workflowTest(`test-${index}`, workflowId))
    const targetIds = [SUBJECT_ID, ...judgeIds]
    const totalRowPreflight = targetIds.map((workflowId) =>
      preflightRow(workflowId, {
        block_count: 1,
        edge_count: MAX_WORKFLOW_EVAL_SNAPSHOT_EDGES_PER_TARGET,
      })
    )
    const totalBytePreflight = targetIds.map((workflowId) =>
      preflightRow(workflowId, {
        workflow_bytes: MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES - 256,
      })
    )

    expect(
      totalRowPreflight.reduce(
        (total, row) => total + Number(row.block_count) + Number(row.edge_count),
        0
      )
    ).toBeGreaterThan(MAX_WORKFLOW_EVAL_SNAPSHOT_TOTAL_ROWS)

    for (const [rows, expectedCode] of [
      [totalRowPreflight, 'total_row_limit_exceeded'],
      [totalBytePreflight, 'total_byte_limit_exceeded'],
    ] as const) {
      vi.clearAllMocks()
      const { tx } = createTx([...rows])
      const error = await captureWorkflowEvalSnapshotTargets({
        tx,
        workspaceId: WORKSPACE_ID,
        subjectWorkflowId: SUBJECT_ID,
        tests,
      }).catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
      expect(error).toMatchObject({ code: expectedCode })
      expect(mockLoadWorkflowDeploymentSnapshot).not.toHaveBeenCalled()
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
    }
  })

  it.each([
    {
      name: 'missing',
      rows: [] as ReturnType<typeof preflightRow>[],
      code: 'missing_workflow',
    },
    {
      name: 'archived',
      rows: [preflightRow(SUBJECT_ID, { archived_at: new Date('2026-01-01') })],
      code: 'archived_workflow',
    },
    {
      name: 'cross-workspace',
      rows: [preflightRow(SUBJECT_ID, { workspace_id: 'workspace-2' })],
      code: 'cross_workspace_workflow',
    },
  ])('rejects a $name target before loading its draft', async ({ rows, code }) => {
    const { tx } = createTx(rows)
    const error = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
    expect(error).toMatchObject({ code, workflowId: SUBJECT_ID })
    expect(mockLoadWorkflowDeploymentSnapshot).not.toHaveBeenCalled()
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
  })

  it('loads and snapshots targets sequentially', async () => {
    const judgeIds = ['workflow-judge-2', 'workflow-judge-1']
    const targetIds = [SUBJECT_ID, ...judgeIds].sort()
    const { tx } = createTx(targetIds.map((id) => preflightRow(id)))
    let resolveFirstTarget: ((state: WorkflowState) => void) | undefined
    mockLoadWorkflowDeploymentSnapshot.mockImplementation((workflowId: string) => {
      if (workflowId !== targetIds[0]) return Promise.resolve(draftState(workflowId))
      return new Promise<WorkflowState>((resolve) => {
        resolveFirstTarget = resolve
      })
    })

    const capture = captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: judgeIds.map((workflowId, index) => workflowTest(`test-${index}`, workflowId)),
    })

    await vi.waitFor(() => expect(mockLoadWorkflowDeploymentSnapshot).toHaveBeenCalledTimes(1))
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
    if (!resolveFirstTarget) throw new Error('First target draft resolver was not initialized')
    resolveFirstTarget(draftState(targetIds[0]))

    await capture

    expect(mockLoadWorkflowDeploymentSnapshot.mock.calls.map(([workflowId]) => workflowId)).toEqual(
      targetIds
    )
    expect(mockCreateSnapshot.mock.calls.map(([workflowId]) => workflowId)).toEqual(targetIds)
  })

  it('enforces the actual serialized byte cap before creating a snapshot', async () => {
    const { tx } = createTx([preflightRow(SUBJECT_ID)])
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValueOnce(
      draftState('x'.repeat(MAX_WORKFLOW_EVAL_SNAPSHOT_TARGET_BYTES + 1))
    )

    const error = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
    expect(error).toMatchObject({ code: 'target_byte_limit_exceeded' })
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
  })

  it('rejects an invalid normalized draft before snapshot creation', async () => {
    const { tx } = createTx([preflightRow(SUBJECT_ID)])
    const invalidState = { ...draftState(), loops: undefined }
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValueOnce(invalidState)

    const error = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
    expect(error).toMatchObject({ code: 'invalid_draft_state' })
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
  })

  it('rejects an error block that is not in the captured subject draft', async () => {
    const { tx } = createTx([preflightRow(SUBJECT_ID)])
    const test = codeTest('missing-error-block')
    test.errorBlockIds = ['deleted-block']

    const error = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [test],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
    expect(error).toMatchObject({
      code: 'invalid_error_block_id',
      workflowId: SUBJECT_ID,
      message:
        'Eval test missing-error-block errorBlockIds references missing subject block deleted-block',
    })
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
  })

  it('rejects a mock block that is not in the captured subject draft', async () => {
    const { tx } = createTx([preflightRow(SUBJECT_ID)])
    const test = codeTest('missing-mock-block')
    test.mocks = [{ blockId: 'deleted-block', output: { result: 'mocked' } }]

    const error = await captureWorkflowEvalSnapshotTargets({
      tx,
      workspaceId: WORKSPACE_ID,
      subjectWorkflowId: SUBJECT_ID,
      tests: [test],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalSnapshotTargetError)
    expect(error).toMatchObject({
      code: 'invalid_mock_block_id',
      workflowId: SUBJECT_ID,
      message: 'Eval test missing-mock-block mocks missing subject block deleted-block',
    })
    expect(mockCreateSnapshot).not.toHaveBeenCalled()
  })
})

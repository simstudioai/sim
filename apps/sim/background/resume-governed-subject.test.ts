/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  task: vi.fn((config) => config),
  getPausedExecutionById: vi.fn(),
  startResumeExecution: vi.fn(),
  snapshotFromJson: vi.fn(),
  createResumeAttemptTimeoutController: vi.fn(),
  findCellContextByExecutionId: vi.fn(),
  pickNextEligibleGroupForRow: vi.fn(),
  withCascadeLock: vi.fn(),
  getTableById: vi.fn(),
  getRowById: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  createWorkflowCellProgressWriter: vi.fn(),
  runRowCascadeLoop: vi.fn(),
  readStampedCapabilitySubject: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mocks.task, timeout: { None: 'none' } }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: (value: unknown) => value,
  billingAttributionsEqual: () => true,
}))
vi.mock('@/lib/table/cascade-lock', () => ({ withCascadeLock: mocks.withCascadeLock }))
vi.mock('@/lib/table/deps', () => ({ isExecCancelled: () => false }))
vi.mock('@/lib/table/workflow-columns', () => ({
  findCellContextByExecutionId: mocks.findCellContextByExecutionId,
  pickNextEligibleGroupForRow: mocks.pickNextEligibleGroupForRow,
}))
vi.mock('@/lib/table/service', () => ({ getTableById: mocks.getTableById }))
vi.mock('@/lib/table/rows/service', () => ({ getRowById: mocks.getRowById }))
vi.mock('@/lib/table/rows/executions', () => ({
  readStampedCapabilitySubject: mocks.readStampedCapabilitySubject,
}))
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: vi.fn(),
  createWorkflowCellProgressWriter: mocks.createWorkflowCellProgressWriter,
  writeWorkflowGroupState: mocks.writeWorkflowGroupState,
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: () => ({ status: 'completed', error: null }),
}))
vi.mock('@/background/workflow-column-execution', () => ({
  runRowCascadeLoop: mocks.runRowCascadeLoop,
}))
vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  createResumeAttemptTimeoutController: mocks.createResumeAttemptTimeoutController,
  PauseResumeManager: {
    getPausedExecutionById: mocks.getPausedExecutionById,
    startResumeExecution: mocks.startResumeExecution,
  },
}))
vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: { fromJSON: mocks.snapshotFromJson },
}))

import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'

const PAYLOAD: ResumeExecutionPayload = {
  resumeEntryId: 'resume-entry-1',
  resumeExecutionId: 'resume-execution-1',
  pausedExecutionId: 'paused-execution-1',
  contextId: 'context-1',
  resumeInput: {},
  /** The resumer / attribution — deliberately NOT the gate's subject. */
  userId: 'workspace-billing-owner',
  workflowId: 'workflow-1',
  parentExecutionId: 'parent-execution-1',
}

const GROUP = {
  id: 'group-1',
  type: 'workflow',
  workflowId: 'workflow-1',
  outputs: [],
  inputMappings: [],
}
const NEXT_GROUP = { ...GROUP, id: 'group-2' }
const TABLE = {
  id: 'table-1',
  name: 'Table',
  workspaceId: 'workspace-1',
  schema: { columns: [], workflowGroups: [GROUP, NEXT_GROUP] },
}

describe('resuming a paused table cell', () => {
  /** The resume worker resolves its collaborators with dynamic imports. */
  beforeAll(async () => {
    await Promise.all([
      import('@/lib/table/cell-write'),
      import('@/lib/table/rows/executions'),
      import('@/lib/table/rows/service'),
      import('@/lib/table/service'),
      import('@/lib/table/workflow-columns'),
      import('@/background/workflow-column-execution'),
    ])
  }, 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPausedExecutionById.mockResolvedValue({ executionSnapshot: { snapshot: {} } })
    mocks.createResumeAttemptTimeoutController.mockReturnValue({
      signal: new AbortController().signal,
      cleanup: vi.fn(),
      abort: vi.fn(),
      isTimedOut: () => false,
      timeoutMs: 5_000,
    })
    mocks.snapshotFromJson.mockReturnValue({
      metadata: {
        billingAttribution: {
          actorUserId: 'workspace-billing-owner',
          workspaceId: 'workspace-1',
        },
      },
    })
    mocks.findCellContextByExecutionId.mockResolvedValue({
      tableId: 'table-1',
      tableName: 'Table',
      rowId: 'row-1',
      groupId: 'group-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      capabilityGovernedUserId: 'requesting-member',
    })
    mocks.getTableById.mockResolvedValue(TABLE)
    mocks.getRowById.mockResolvedValue({ id: 'row-1', data: {}, executions: {} })
    mocks.pickNextEligibleGroupForRow.mockReturnValue(NEXT_GROUP)
    mocks.readStampedCapabilitySubject.mockResolvedValue('other-dispatchers-member')
    mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
    mocks.createWorkflowCellProgressWriter.mockReturnValue({
      onBlockComplete: vi.fn(),
      finish: vi.fn(),
      getEventOutputs: () => ({}),
      getPendingDataPatch: () => ({}),
      getBlockErrors: () => ({}),
      getPendingSecretProvenance: () => undefined,
    })
    mocks.startResumeExecution.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
    })
    mocks.withCascadeLock.mockImplementation(
      async (
        _tableId: string,
        _rowId: string,
        _executionId: string,
        fn: () => Promise<unknown>
      ) => ({
        status: 'ran',
        result: await fn(),
      })
    )
  })

  /**
   * The scenario the gate exists for: the cell was stamped with the person
   * whose group denies a tool, then paused on a wait block. If the subject does
   * not survive the pause, the cascade the resume drives runs ungated and the
   * denied tool executes.
   */
  it('drives the post-resume cascade under the subject stamped before the pause', async () => {
    await executeResumeJob(PAYLOAD)

    expect(mocks.runRowCascadeLoop).toHaveBeenCalledTimes(1)
    const [cascadePayload] = mocks.runRowCascadeLoop.mock.calls[0]
    expect(cascadePayload.capabilityGovernedUserId).toBe('requesting-member')
    expect(cascadePayload.capabilityGovernedUserId).not.toBe(PAYLOAD.userId)
  }, 20_000)

  /**
   * The next group is not a dependency this cascade satisfied — it carries
   * another dispatch's unclaimed pre-stamp, an explicit request from someone
   * else that this cascade happens to be draining. Carrying the paused cell's
   * subject into it would run a stranger's request under the wrong denylist,
   * which is the decision both drain points in `workflow-column-execution.ts`
   * already make off the stamp.
   */
  it('runs another dispatch’s queued marker under the subject stamped with it', async () => {
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: {},
      executions: { 'group-2': { status: 'pending', executionId: null, workflowId: 'workflow-1' } },
    })

    await executeResumeJob(PAYLOAD)

    expect(mocks.readStampedCapabilitySubject).toHaveBeenCalledWith('row-1', 'group-2')
    const [cascadePayload] = mocks.runRowCascadeLoop.mock.calls[0]
    expect(cascadePayload.capabilityGovernedUserId).toBe('other-dispatchers-member')
  }, 20_000)

  /** A claimed cell is ordinary dependency work and keeps the paused subject. */
  it('keeps the paused cell’s subject for a marker another worker already claimed', async () => {
    mocks.getRowById.mockResolvedValue({
      id: 'row-1',
      data: {},
      executions: {
        'group-2': { status: 'pending', executionId: 'execution-9', workflowId: 'workflow-1' },
      },
    })

    await executeResumeJob(PAYLOAD)

    expect(mocks.readStampedCapabilitySubject).not.toHaveBeenCalled()
    const [cascadePayload] = mocks.runRowCascadeLoop.mock.calls[0]
    expect(cascadePayload.capabilityGovernedUserId).toBe('requesting-member')
  }, 20_000)

  it('resumes ungated when the paused cell had no acting person', async () => {
    mocks.findCellContextByExecutionId.mockResolvedValue({
      tableId: 'table-1',
      tableName: 'Table',
      rowId: 'row-1',
      groupId: 'group-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      capabilityGovernedUserId: null,
    })

    await executeResumeJob(PAYLOAD)

    const [cascadePayload] = mocks.runRowCascadeLoop.mock.calls[0]
    expect(cascadePayload.capabilityGovernedUserId).toBeNull()
  }, 20_000)
})

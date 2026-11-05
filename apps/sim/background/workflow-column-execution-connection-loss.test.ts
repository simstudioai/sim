/**
 * What a table cell does when a database socket is reset underneath it, written from the ways it
 * has failed in production:
 *
 * - A reset on a read before the run crashed the task and left the cell `pending` for good.
 * - A reset on the read that advances the cascade stranded the row's remaining groups.
 * - Driver text, and sometimes SQL with bound values, was stored as the cell's visible error.
 *
 * The guard that must never regress runs the other way: a block has effects, so nothing here may
 * start a workflow twice. What a repeated state write does is proven against real PostgreSQL in
 * `lib/table/cell-write.integration.ts`.
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import {
  executeWorkflowMock,
  executeWorkflowMockFns,
} from '@sim/testing/mocks/execute-workflow.mock'
import {
  executionPreprocessingMock,
  executionPreprocessingMockFns,
} from '@sim/testing/mocks/execution-preprocessing.mock'
import {
  tableRowsServiceMock,
  tableRowsServiceMockFns,
} from '@sim/testing/mocks/table-rows-service.mock'
import { tableServiceMock, tableServiceMockFns } from '@sim/testing/mocks/table-service.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import { utilsHelpersMock } from '@sim/testing/mocks/utils-helpers.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const local = vi.hoisted(() => ({
  readDispatch: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  markWorkflowGroupPickedUp: vi.fn(),
}))

const mocks = {
  ...local,
  getTableById: tableServiceMockFns.mockGetTableById,
  getRowById: tableRowsServiceMockFns.mockGetRowById,
  getRowSummaryById: tableRowsServiceMockFns.mockGetRowSummaryById,
  executeWorkflow: executeWorkflowMockFns.mockExecuteWorkflow,
  loadDeployedWorkflowState: workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState,
  preprocessExecution: executionPreprocessingMockFns.mockPreprocessExecution,
  pickNextEligibleGroupForRow: tableWorkflowColumnsMockFns.mockPickNextEligibleGroupForRow,
  selectWorkflow: dbChainMockFns.limit,
}

vi.mock('@sim/utils/helpers', () => utilsHelpersMock)
vi.mock('@/lib/table/service', () => tableServiceMock)
vi.mock('@/lib/table/rows/service', () => tableRowsServiceMock)
vi.mock('@/lib/table/rows/executions', () => ({ readStampedCapabilitySubject: vi.fn() }))
vi.mock('@/lib/table/dispatcher', () => ({ readDispatch: local.readDispatch }))
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/table/cell-write', () => ({
  buildCancelledExecution: vi.fn(),
  writeWorkflowGroupState: vi.fn(),
  writeWorkflowGroupStateDurably: local.writeWorkflowGroupState,
  markWorkflowGroupPickedUp: local.markWorkflowGroupPickedUp,
  createWorkflowCellProgressWriter: () => ({
    onBlockStart: vi.fn(),
    onBlockComplete: vi.fn(),
    finish: vi.fn(async () => {}),
    getEventOutputs: () => ({}),
    getPendingDataPatch: () => ({ out: 'value' }),
    getPendingSecretProvenance: () => ({}),
    getBlockErrors: () => ({}),
  }),
}))
vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitWithSubscription = vi.fn(async () => ({ allowed: true }))
  },
}))
vi.mock('@/lib/table/workflow-cell-result', () => ({
  classifyWorkflowCellTerminalResult: () => ({ status: 'completed', error: null }),
}))

import { runRowCascadeLoop } from '@/background/workflow-column-execution'

const GROUP = { id: 'group-1', workflowId: 'workflow-1', outputs: [] }
const NEXT_GROUP = { id: 'group-2', workflowId: 'workflow-2', outputs: [] }
const TABLE = {
  id: 'table-1',
  schema: { columns: [], workflowGroups: [GROUP, NEXT_GROUP] },
}
const ROW = { id: 'row-1', data: {}, executions: {} }
const PAYLOAD = {
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  dispatchId: 'dispatch-1',
  executionTimeoutMs: 60_000,
  capabilityGovernedUserId: null,
  billingAttribution: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user' as const, id: 'user-1' },
    billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    payerSubscription: null,
  },
}

/** Drizzle's wrapper around a reset socket, the shape a reset read rejects with in production. */
function resetRead(): Error {
  return Object.assign(
    new Error('Failed query: select "id" from "x"\nparams: secret-value', {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' }),
    }),
    { query: 'select "id" from "x"', params: ['secret-value'] }
  )
}

/** The bare driver error a reset during `BEGIN` rejects with: no Drizzle wrapper, no cause. */
function resetBegin(): Error {
  const error = Object.assign(new Error('read ECONNRESET'), {
    code: 'ECONNRESET',
    syscall: 'read',
  })
  for (const property of ['query', 'parameters', 'args', 'types']) {
    Object.defineProperty(error, property, { value: undefined })
  }
  return error
}

const writtenStatuses = () =>
  mocks.writeWorkflowGroupState.mock.calls.map(([, write]) => write.executionState.status)
const lastWrite = () => mocks.writeWorkflowGroupState.mock.calls.at(-1)?.[1]

beforeEach(() => {
  resetDbChainMock()
  mocks.getTableById.mockResolvedValue(TABLE)
  mocks.getRowById.mockResolvedValue(ROW)
  mocks.getRowSummaryById.mockResolvedValue({ id: 'row-1', data: {} })
  mocks.readDispatch.mockResolvedValue({ id: 'dispatch-1', status: 'active' })
  mocks.writeWorkflowGroupState.mockResolvedValue('wrote')
  mocks.markWorkflowGroupPickedUp.mockResolvedValue('wrote')
  mocks.executeWorkflow.mockResolvedValue({ status: 'completed', success: true, output: {} })
  mocks.loadDeployedWorkflowState.mockResolvedValue({
    blocks: { start: { id: 'start', type: 'start_trigger', subBlocks: {}, outputs: {} } },
    edges: [],
    loops: {},
    parallels: {},
  })
  mocks.preprocessExecution.mockResolvedValue({
    success: true,
    actorUserId: 'user-1',
    actorSubscription: null,
    billingAttribution: PAYLOAD.billingAttribution,
  })
  mocks.pickNextEligibleGroupForRow.mockReturnValue(null)
  mocks.selectWorkflow.mockResolvedValue([
    { id: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1', variables: {} },
  ])
})

describe('a table cell losing a database socket', () => {
  it('recovers a reset on the dispatch read and runs the cell', async () => {
    mocks.readDispatch.mockRejectedValueOnce(resetRead())

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).toHaveBeenCalledOnce()
    expect(writtenStatuses()).toEqual(['completed'])
  })

  it('terminalizes the cell when the dispatch read never recovers, instead of stranding it', async () => {
    mocks.readDispatch.mockRejectedValue(resetRead())

    await expect(runRowCascadeLoop(PAYLOAD)).resolves.toBeUndefined()

    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
    expect(lastWrite()?.executionState.status).toBe('error')
  })

  it('fails the run loudly when the cell cannot be terminalized either', async () => {
    const lost = resetBegin()
    mocks.readDispatch.mockRejectedValue(resetRead())
    mocks.writeWorkflowGroupState.mockRejectedValue(lost)

    await expect(runRowCascadeLoop(PAYLOAD)).rejects.toBe(lost)
  })

  it('never restarts a workflow whose run lost its connection', async () => {
    mocks.executeWorkflow.mockRejectedValue(resetRead())

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).toHaveBeenCalledOnce()
    expect(lastWrite()?.executionState.status).toBe('error')
  })

  it('marks the cell failed when its terminal write cannot be completed', async () => {
    mocks.writeWorkflowGroupState.mockRejectedValueOnce(resetBegin())

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).toHaveBeenCalledOnce()
    expect(writtenStatuses()).toEqual(['completed', 'error'])
  })

  it('ends the carrier instead of starting the next group when a Stop owns the failed cell', async () => {
    mocks.readDispatch.mockRejectedValue(resetRead())
    mocks.writeWorkflowGroupState.mockResolvedValue('skipped')

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.pickNextEligibleGroupForRow).not.toHaveBeenCalled()
    expect(mocks.executeWorkflow).not.toHaveBeenCalled()
  })

  it('records a pre-run failure on an enrichment cell under its enrichment id', async () => {
    mocks.readDispatch.mockRejectedValue(resetRead())
    mocks.getTableById.mockResolvedValue({
      ...TABLE,
      schema: {
        columns: [],
        workflowGroups: [{ ...GROUP, type: 'enrichment', enrichmentId: 'work-email' }],
      },
    })

    await runRowCascadeLoop(PAYLOAD)

    expect(lastWrite()?.executionState).toMatchObject({ status: 'error', workflowId: 'work-email' })
  })

  it('never stores a thrown message from before the cell reached a terminal state', async () => {
    mocks.readDispatch.mockRejectedValue(
      new Error(
        'Coalesced producer for "usage-gate:org-1:billed-user" did not settle within 5000ms'
      )
    )

    await runRowCascadeLoop(PAYLOAD)

    expect(lastWrite()?.executionState.error).not.toMatch(/usage-gate|org-1|billed-user/)
  })

  it('advances the cascade past a reset on the read that picks the next group', async () => {
    mocks.getRowById
      .mockResolvedValueOnce(ROW)
      .mockRejectedValueOnce(resetRead())
      .mockResolvedValue(ROW)
    mocks.pickNextEligibleGroupForRow.mockReturnValueOnce(NEXT_GROUP).mockReturnValue(null)

    await runRowCascadeLoop(PAYLOAD)

    expect(mocks.executeWorkflow).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a reset read', resetRead],
    ['a reset BEGIN', resetBegin],
  ])('does not store driver text or SQL as the cell error after %s', async (_name, failure) => {
    mocks.executeWorkflow.mockRejectedValue(failure())

    await runRowCascadeLoop(PAYLOAD)

    const stored = lastWrite()?.executionState.error
    expect(stored).not.toMatch(/ECONNRESET|Failed query|select|secret-value/)
  })

  it('keeps a block error that names the block over a database cause', async () => {
    const message = 'Agent 1: An internal error occurred while executing the block.'
    mocks.executeWorkflow.mockRejectedValue(new Error(message, { cause: resetRead() }))

    await runRowCascadeLoop(PAYLOAD)

    expect(lastWrite()?.executionState.error).toBe(message)
  })

  it('does not tell the user to re-run a query that will fail the same way', async () => {
    mocks.executeWorkflow.mockRejectedValue(
      Object.assign(new Error('Failed query: update "x"\nparams: secret-value'), {
        query: 'update "x"',
        params: ['secret-value'],
        cause: Object.assign(new Error('unsupported Unicode escape'), { code: '22P05' }),
      })
    )

    await runRowCascadeLoop(PAYLOAD)

    const stored = lastWrite()?.executionState.error
    expect(stored).not.toMatch(/Failed query|secret-value|again/)
  })

  it('keeps the message of a failure that has nothing to do with the database', async () => {
    mocks.executeWorkflow.mockRejectedValue(new Error('Workflow has no blocks'))

    await runRowCascadeLoop(PAYLOAD)

    expect(lastWrite()?.executionState.error).toBe('Workflow has no blocks')
  })
})

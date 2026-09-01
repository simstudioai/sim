/**
 * @vitest-environment node
 */

import { tableRowExecutions, userTableRows, workflowExecutionLogs } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockBatchUpdateRows, mockMaterializeExecutionData, mockGetFunctionalBlockOutput } =
  vi.hoisted(() => ({
    mockBatchUpdateRows: vi.fn(),
    mockMaterializeExecutionData: vi.fn(),
    mockGetFunctionalBlockOutput: vi.fn(),
  }))

vi.mock('@/lib/table/rows/service', () => ({
  batchUpdateRows: mockBatchUpdateRows,
}))
vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionData: mockMaterializeExecutionData,
}))
vi.mock('@/lib/logs/execution/functional-outputs', () => ({
  getFunctionalBlockOutput: mockGetFunctionalBlockOutput,
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  createTableRowSecretProvenanceFromRegistry: () => ({ complete: true, columns: {} }),
}))

import { maybeBackfillGroupOutputs } from '@/lib/table/backfill-runner'

const TABLE = {
  id: 'table-1',
  workspaceId: 'workspace-1',
  schema: { columns: [], workflowGroups: [] },
} as unknown as TableDefinition

/** Queues the four reads one inline backfill page makes, in the order it makes them. */
function queueOnePage(): void {
  queueTableRows(tableRowExecutions, [{ count: 1 }])
  queueTableRows(tableRowExecutions, [{ rowId: 'row-1', executionId: 'execution-1' }])
  queueTableRows(userTableRows, [{ id: 'row-1', data: {} }])
  queueTableRows(workflowExecutionLogs, [
    {
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionData: {},
    },
  ])
  queueTableRows(tableRowExecutions, [])
}

describe('backfill cascade governance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockMaterializeExecutionData.mockResolvedValue({})
    mockGetFunctionalBlockOutput.mockReturnValue({ value: 'filled' })
    mockBatchUpdateRows.mockResolvedValue({ affectedCount: 1, affectedRowIds: ['row-1'] })
  })

  /**
   * A backfilled cell is a dependency: `batchUpdateRows` starts every downstream
   * group whose deps it just satisfied. Passing no subject there ran those
   * cells with no per-tool gate, which is what `null` means on this field.
   */
  it('cascades under the person who made the schema change', async () => {
    queueOnePage()

    await maybeBackfillGroupOutputs({
      table: TABLE,
      groupId: 'group-1',
      outputs: [{ blockId: 'block-1', path: 'value', columnName: 'value' }],
      overwrite: true,
      requestId: 'request-1',
      actorUserId: 'billed-owner',
      capabilityGovernedUserId: 'member-1',
    })

    expect(mockBatchUpdateRows).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'billed-owner',
        capabilityGovernedUserId: 'member-1',
      }),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  /**
   * The one payload that can omit the field is a large backfill enqueued before
   * it existed and still running after the deploy. `actorUserId` is not a
   * recovery: `attributedUserId` yields the workspace's billed account for a
   * change made by a workspace API key, and nothing here tells that apart from
   * a human — so borrowing it would apply a bystander's denylist, the exact
   * substitution this field removes. Null for one deploy's worth of in-flight
   * jobs is the least wrong of the available answers.
   */
  it('keeps an absent subject null rather than borrowing the billing actor', async () => {
    queueOnePage()

    await maybeBackfillGroupOutputs({
      table: TABLE,
      groupId: 'group-1',
      outputs: [{ blockId: 'block-1', path: 'value', columnName: 'value' }],
      overwrite: true,
      requestId: 'request-1',
      actorUserId: 'billed-owner',
    })

    expect(mockBatchUpdateRows).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGovernedUserId: null }),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})

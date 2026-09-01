/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findCellContextByExecutionId,
  stashCellContextForResume,
} from '@/lib/table/workflow-columns'

const CONTEXT = {
  executionId: 'execution-1',
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  capabilityGovernedUserId: 'requesting-member',
}

/**
 * The pause snapshot is `paused_executions.metadata`, a jsonb document, so the
 * subject rides it without a schema change. What this pins is that it is
 * actually written and read back — the resume worker has no other source for
 * it once the row's marker has been claimed.
 */
describe('the governed subject across a pause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('writes the subject into the stashed cell context', async () => {
    await stashCellContextForResume(CONTEXT)

    const [{ metadata }] = dbChainMockFns.set.mock.calls[0]
    /** The jsonb literal the `||` merge appends, as bound to the SQL template. */
    const [, serializedPatch] = (metadata as { values: string[] }).values
    expect(JSON.parse(serializedPatch).cellContext).toMatchObject({
      capabilityGovernedUserId: 'requesting-member',
    })
  })

  it('reads the stashed subject back', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { metadata: { cellContext: { ...CONTEXT, executionId: undefined } } },
    ])

    const context = await findCellContextByExecutionId('execution-1')

    expect(context?.capabilityGovernedUserId).toBe('requesting-member')
  })

  /** A pause stashed before the subject was carried must read as ungated, not
   *  as `undefined` leaking into the payload the compiler now requires. */
  it('normalizes a legacy stash with no subject to null', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        metadata: {
          cellContext: {
            tableId: 'table-1',
            tableName: 'Table',
            rowId: 'row-1',
            groupId: 'group-1',
            workspaceId: 'workspace-1',
            workflowId: 'workflow-1',
          },
        },
      },
    ])

    const context = await findCellContextByExecutionId('execution-1')

    expect(context).not.toBeNull()
    expect(context?.capabilityGovernedUserId).toBeNull()
  })
})

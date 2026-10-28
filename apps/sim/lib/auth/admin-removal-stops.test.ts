/**
 * The `/admin/remove-user` hooks hand a plan from `before` to `after` across a non-transactional
 * delete. Failure modes:
 * - the outbox write fails after the delete committed → the in-flight runs must still be signalled
 * - `after` runs for a different delete than the one `before` read → nothing is stopped
 */
import { workflowExecutionLogs, workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { holdAdminRemovalStops, stopAdminRemovedRuns } from '@/lib/auth/admin-removal-stops'

const mockEval = vi.fn()

function queueRunningExecution(executionId: string) {
  queueTableRows(workspace, [])
  queueTableRows(workflowExecutionLogs, [
    { executionId, executionDeadlineAt: null, workspaceId: 'workspace-elsewhere' },
  ])
  queueTableRows(workflowExecutionLogs, [])
}

describe('admin user removal stops', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockEval.mockReset().mockResolvedValue(1)
    redisConfigMockFns.mockGetRedisClient.mockReturnValue({ eval: mockEval })
  })

  it('signals the removed user’s runs even when their stops cannot be recorded', async () => {
    const user = { id: 'user-1' }
    queueRunningExecution('execution-1')
    await holdAdminRemovalStops(user)
    dbChainMockFns.insert.mockImplementationOnce(() => {
      throw new Error('outbox unavailable')
    })

    await expect(stopAdminRemovedRuns(user)).resolves.toBeUndefined()

    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'execution:cancel:execution-1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('stops nothing for a delete whose runs it did not read', async () => {
    queueRunningExecution('execution-2')
    await holdAdminRemovalStops({ id: 'user-2' })

    await stopAdminRemovedRuns({ id: 'user-2' })

    expect(mockEval).not.toHaveBeenCalled()
  })
})

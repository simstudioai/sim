import {
  humanInTheLoopManagerMock,
  humanInTheLoopManagerMockFns,
} from '@sim/testing/mocks/human-in-the-loop-manager.mock'
import { loggingSessionMockFns } from '@sim/testing/mocks/logging-session.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoggingSession } from '@/lib/logs/execution/logging-session'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import type { ExecutionResult } from '@/executor/types'

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)

const loggingSession = {
  waitForPostExecution: loggingSessionMockFns.mockWaitForPostExecution,
  hasCompleted: loggingSessionMockFns.mockHasCompleted,
  getDeletedScope: loggingSessionMockFns.mockGetDeletedScope,
  markAsFailed: loggingSessionMockFns.mockMarkAsFailed,
} as unknown as LoggingSession

const pausedResult: ExecutionResult = { success: true, output: {}, status: 'paused' }

describe('handlePostExecutionPauseState for a paused run that was never finalized', () => {
  beforeEach(() => {
    loggingSessionMockFns.mockHasCompleted.mockReturnValue(false)
    loggingSessionMockFns.mockGetDeletedScope.mockReturnValue(null)
  })

  it('leaves a run alone when its workspace was deleted while it paused', async () => {
    loggingSessionMockFns.mockGetDeletedScope.mockReturnValue('workspace')

    await handlePostExecutionPauseState({
      result: pausedResult,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      loggingSession,
    })

    expect(loggingSessionMockFns.mockMarkAsFailed).not.toHaveBeenCalled()
    expect(humanInTheLoopManagerMockFns.mockPersistPauseResult).not.toHaveBeenCalled()
  })

  it('still force-fails a run whose paused log was not finalized for any other reason', async () => {
    await handlePostExecutionPauseState({
      result: pausedResult,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      loggingSession,
    })

    expect(loggingSessionMockFns.mockMarkAsFailed).toHaveBeenCalledWith(
      'Failed to record paused execution'
    )
    expect(humanInTheLoopManagerMockFns.mockPersistPauseResult).not.toHaveBeenCalled()
  })
})

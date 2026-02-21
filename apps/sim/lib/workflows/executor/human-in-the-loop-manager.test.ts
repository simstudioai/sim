import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {
    transaction: vi.fn(),
  },
}))

import { db } from '@sim/db'
import {
  PausedExecutionNotFoundError,
  PausePointNotFoundError,
  PauseSnapshotNotReadyError,
} from '@/lib/workflows/executor/pause-resume-errors'

describe('PauseResumeManager.enqueueOrStartResume', () => {
  let PauseResumeManager: typeof import('@/lib/workflows/executor/human-in-the-loop-manager').PauseResumeManager

  beforeAll(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    ;({ PauseResumeManager } = await import('@/lib/workflows/executor/human-in-the-loop-manager'))
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries when paused execution is not yet persisted', async () => {
    vi.mocked(db.transaction)
      .mockRejectedValueOnce(new PausedExecutionNotFoundError())
      .mockRejectedValueOnce(new PausedExecutionNotFoundError())
      .mockResolvedValueOnce({
        status: 'queued',
        resumeExecutionId: 'exec-1',
        queuePosition: 1,
      } as any)

    const promise = PauseResumeManager.enqueueOrStartResume({
      executionId: 'exec-1',
      contextId: 'ctx-1',
      resumeInput: { ok: true },
      userId: 'user-1',
    })

    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({
      status: 'queued',
      resumeExecutionId: 'exec-1',
      queuePosition: 1,
    })
    expect(db.transaction).toHaveBeenCalledTimes(3)
  })

  it('retries when snapshot is not ready yet', async () => {
    vi.mocked(db.transaction)
      .mockRejectedValueOnce(new PauseSnapshotNotReadyError())
      .mockResolvedValueOnce({
        status: 'queued',
        resumeExecutionId: 'exec-2',
        queuePosition: 1,
      } as any)

    const promise = PauseResumeManager.enqueueOrStartResume({
      executionId: 'exec-2',
      contextId: 'ctx-2',
      resumeInput: null,
      userId: 'user-2',
    })

    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({
      status: 'queued',
      resumeExecutionId: 'exec-2',
    })
    expect(db.transaction).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient errors', async () => {
    vi.mocked(db.transaction).mockRejectedValueOnce(new PausePointNotFoundError())

    const promise = PauseResumeManager.enqueueOrStartResume({
      executionId: 'exec-3',
      contextId: 'ctx-3',
      resumeInput: null,
      userId: 'user-3',
    })

    await expect(promise).rejects.toThrow('Pause point not found for execution')
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })

  it('stops retrying after max attempts', async () => {
    vi.mocked(db.transaction).mockRejectedValue(new PausedExecutionNotFoundError())

    const promise = PauseResumeManager.enqueueOrStartResume({
      executionId: 'exec-4',
      contextId: 'ctx-4',
      resumeInput: null,
      userId: 'user-4',
    })

    const assertion = expect(promise).rejects.toThrow(PausedExecutionNotFoundError)
    await vi.runAllTimersAsync()
    await assertion
    expect(db.transaction).toHaveBeenCalledTimes(8)
  })

  it('retries across transient failures until success', async () => {
    vi.mocked(db.transaction)
      .mockRejectedValueOnce(new PausedExecutionNotFoundError())
      .mockRejectedValueOnce(new PauseSnapshotNotReadyError())
      .mockResolvedValueOnce({
        status: 'queued',
        resumeExecutionId: 'exec-5',
        queuePosition: 1,
      } as any)

    const promise = PauseResumeManager.enqueueOrStartResume({
      executionId: 'exec-5',
      contextId: 'ctx-5',
      resumeInput: null,
      userId: 'user-5',
    })

    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({
      status: 'queued',
      resumeExecutionId: 'exec-5',
    })
    expect(db.transaction).toHaveBeenCalledTimes(3)
  })
})

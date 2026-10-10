/** @vitest-environment node */

import { inputValidationMock } from '@sim/testing/mocks/input-validation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type OracleEpmPollClassification,
  type OracleEpmPollOptions,
  type OracleEpmPollResult,
  pollOracleEpmJob,
} from '@/lib/internal/oracle-epm'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

describe('pollOracleEpmJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), milliseconds)
      return controller.signal
    })
  })

  afterEach(() => vi.useRealTimers())

  it('leaves status interpretation and result extraction to the child', async () => {
    type Snapshot = { status: 'RUNNING' } | { status: 'DONE'; value: number }
    const read = vi
      .fn<OracleEpmPollOptions<Snapshot, number, never>['read']>()
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'DONE', value: 42 })
    const pending: Promise<OracleEpmPollResult<number, never>> = pollOracleEpmJob({
      read,
      classify: (snapshot): OracleEpmPollClassification<number, never> =>
        snapshot.status === 'DONE'
          ? { state: 'success' as const, result: snapshot.value }
          : { state: 'pending' as const },
      maxWaitMs: 1_000,
      cleanupReserveMs: 10,
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 1,
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ state: 'success', result: 42, attempts: 2 })
  })

  it('returns child-owned terminal failures unchanged', async () => {
    const failure = Object.freeze({ code: 'CHILD_FAILURE' })
    await expect(
      pollOracleEpmJob({
        read: async () => ({ status: 'FAILED' }),
        classify: () => ({ state: 'failure', error: failure }),
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).resolves.toEqual({ state: 'failure', error: failure, attempts: 1 })
  })

  it('rejects invalid classifier output and attempt exhaustion', async () => {
    await expect(
      pollOracleEpmJob({
        read: async () => ({}),
        classify: () => ({ state: 'unknown' }) as never,
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toThrow('classifier')
    await expect(
      pollOracleEpmJob({
        read: async () => ({}),
        classify: () => ({ state: 'pending' }),
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toThrow('attempt limit')
  })

  it('honors caller aborts and cleanup reserve', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('user', 'AbortError'))
    await expect(
      pollOracleEpmJob({
        read: async () => ({}),
        classify: () => ({ state: 'pending' }),
        signal: controller.signal,
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      pollOracleEpmJob({
        read: async () => ({}),
        classify: () => ({ state: 'pending' }),
        deadlineAt: new Date(Date.now() + 5),
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('enforces the scheduler deadline when a child read ignores cancellation', async () => {
    let readSignal: AbortSignal | undefined
    const startedAt = Date.now()
    const pending = expect(
      pollOracleEpmJob({
        read: async (signal) => {
          readSignal = signal
          return new Promise<never>(() => undefined)
        },
        classify: () => ({ state: 'pending' }),
        maxWaitMs: 40,
        cleanupReserveMs: 10,
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(30)
    await pending
    expect(Date.now() - startedAt).toBe(30)
    expect(readSignal?.aborted).toBe(true)
  })

  it('does not return a terminal result when cancellation occurs during classification', async () => {
    const controller = new AbortController()
    await expect(
      pollOracleEpmJob({
        read: async () => ({ status: 'DONE' }),
        classify: () => {
          controller.abort(new DOMException('user', 'AbortError'))
          return { state: 'success', result: 42 }
        },
        signal: controller.signal,
        maxWaitMs: 1_000,
        cleanupReserveMs: 10,
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

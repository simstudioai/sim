/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'

describe('pollOracleEpmJob', () => {
  it('leaves status interpretation and result extraction to the child', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 'RUNNING' })
      .mockResolvedValueOnce({ status: 'DONE', value: 42 })
    const result = await pollOracleEpmJob({
      read,
      classify: (snapshot) =>
        snapshot.status === 'DONE'
          ? { state: 'success' as const, result: snapshot.value }
          : { state: 'pending' as const },
      maxWaitMs: 1_000,
      cleanupReserveMs: 10,
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 1,
    })
    expect(result).toEqual({ state: 'success', result: 42, attempts: 2 })
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
})

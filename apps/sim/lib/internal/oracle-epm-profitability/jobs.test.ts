/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { executeOraclePcmJobOperation } from '@/lib/internal/oracle-epm-profitability/jobs'

const params = {
  oauthCredential: 'credential-1',
  accessToken: Buffer.from('test-user:test-password').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway',
  processName: 'Task-1',
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

describe('Oracle PCM task monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(() => json({ status: 0, details: null }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [-1, 'pending'],
    [0, 'succeeded'],
    [1, 'failed'],
    [2, 'failed'],
    [99, 'failed'],
  ])('interprets migration status %s as %s', async (status, state) => {
    mocks.fetch.mockImplementation(() => json({ status, details: null }))
    expect(await executeOraclePcmJobOperation('get_task_status', params)).toMatchObject({
      success: true,
      output: { processName: 'Task-1', status, state },
    })
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/epm/rest/v1/applications/jobs/ChecktaskStatusJob/Task-1'
    )
    expect(mocks.fetch.mock.calls[0][2].method).toBe('GET')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('polls pending to success using reads only', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementationOnce(() => json({ status: -1 }))
    const result = executeOraclePcmJobOperation('wait_for_task', params)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await result).toMatchObject({
      success: true,
      retryable: false,
      output: { processName: 'Task-1', status: 0, attempts: 2, timedOut: false },
    })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })

  it('stops immediately on positive status without replaying the mutation', async () => {
    mocks.fetch.mockImplementation(() => json({ status: 2 }))
    expect(await executeOraclePcmJobOperation('wait_for_task', params)).toMatchObject({
      success: false,
      retryable: false,
      output: { processName: 'Task-1', state: 'failed', attempts: 1, timedOut: false },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns the last task and identifier when the bounded wait expires', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation(() => json({ status: -1, details: 'Running' }))
    const result = executeOraclePcmJobOperation('wait_for_task', { ...params, maxWaitSeconds: 1 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await result).toMatchObject({
      success: false,
      retryable: false,
      output: { processName: 'Task-1', timedOut: true, status: -1, details: 'Running' },
    })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })

  it('retains the identifier on a transport timeout before the first status response', async () => {
    mocks.fetch.mockRejectedValue(oracleEpmLocalError('timeout'))
    expect(await executeOraclePcmJobOperation('wait_for_task', params)).toMatchObject({
      success: false,
      retryable: false,
      output: { processName: 'Task-1', timedOut: true },
    })
  })

  it('propagates cancellation without cancelling the remote task', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation(() => json({ status: -1 }))
    const controller = new AbortController()
    const result = expect(
      executeOraclePcmJobOperation('wait_for_task', params, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await result
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })

  it.each(['', '../Task-1', 'a/b'])(
    'rejects invalid task references before HTTP',
    async (processName) => {
      await expect(
        executeOraclePcmJobOperation('get_task_status', { ...params, processName })
      ).rejects.toThrow()
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )

  it('rejects fractional wait budgets before invoking the polling scheduler', async () => {
    await expect(
      executeOraclePcmJobOperation('wait_for_task', { ...params, maxWaitSeconds: 1.0001 })
    ).rejects.toThrow('maxWaitSeconds')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rejects undocumented task response shapes', async () => {
    mocks.fetch.mockImplementation(() => json({ status: '0', processName: 'invented' }))
    await expect(executeOraclePcmJobOperation('get_task_status', params)).rejects.toThrow(
      'contract'
    )
  })
})

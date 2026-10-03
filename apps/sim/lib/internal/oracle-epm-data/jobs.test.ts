/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({
  createOracleEpmClient: () => ({ request: mocks.request }),
}))

import { oracleEpmDataEndpoints } from '@/lib/internal/oracle-epm-data/contracts'
import {
  classifyOracleEpmDataJob,
  finishOracleEpmDataJob,
} from '@/lib/internal/oracle-epm-data/jobs'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'resolved',
  instanceUrl: 'https://epm.example.com',
}
const submitted = { status: 200, data: { status: -1, jobId: 42, details: null } }
describe('Data Integration job waiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [-1, 'pending'],
    [2, 'pending'],
    [0, 'success'],
    [1, 'failure'],
    [3, 'failure'],
    [4, 'failure'],
    [2147483647, 'unknown'],
    [99, 'unknown'],
  ] as const)('classifies %s as %s', (status, expected) => {
    expect(classifyOracleEpmDataJob(status)).toBe(expected)
  })

  it('returns immediately by default and does not interpret HTTP success as completion', async () => {
    expect(await finishOracleEpmDataJob(auth, submitted, false)).toMatchObject({
      success: true,
      output: { httpStatus: 200, status: -1, jobId: '42' },
    })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('waits through cancel-pending to a terminal status without repeating submission', async () => {
    mocks.request
      .mockResolvedValueOnce({ status: 200, data: { status: 2, jobId: '42' } })
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 0, jobId: 42, outputFileName: 'outbox/result.csv' },
      })
    const pending = finishOracleEpmDataJob(auth, submitted, true)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({
      success: true,
      output: { status: 0, jobId: '42', outputFileName: 'outbox/result.csv' },
    })
    expect(mocks.request).toHaveBeenCalledTimes(2)
    for (const [endpoint, input] of mocks.request.mock.calls) {
      expect(endpoint).toBe(oracleEpmDataEndpoints.getJob)
      expect(input.pathParams).toEqual({ jobId: '42' })
      expect(input.json).toBeUndefined()
    }
  })

  it.each([1, 3, 4, 2147483647])(
    'reports unsuccessful terminal %s without polling',
    async (status) => {
      expect(
        await finishOracleEpmDataJob(auth, { status: 200, data: { status, jobId: 42 } }, true)
      ).toMatchObject({ success: false, retryable: false, output: { status, jobId: '42' } })
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('retains the latest result and ID after the five-minute deadline', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { status: 2, jobId: 42, logFileName: 'outbox/log.txt' },
    })
    const pending = finishOracleEpmDataJob(auth, submitted, true)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await pending).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 2, jobId: '42', logFileName: 'outbox/log.txt' },
      error: expect.stringContaining('get_job_status'),
    })
    expect(
      mocks.request.mock.calls.every(([endpoint]) => endpoint === oracleEpmDataEndpoints.getJob)
    ).toBe(true)
  })

  it('retains known status on polling errors and rejects a mismatched execution ID', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Synthetic transport failure'))
    expect(await finishOracleEpmDataJob(auth, submitted, true)).toMatchObject({
      success: false,
      output: { status: -1, jobId: '42' },
    })
    mocks.request.mockResolvedValueOnce({ status: 200, data: { status: 0, jobId: 43 } })
    expect(await finishOracleEpmDataJob(auth, submitted, true)).toMatchObject({
      success: false,
      output: { status: -1, jobId: '42' },
      error: expect.stringContaining('different job ID'),
    })
  })

  it('honors cancellation and does not poll placeholder snapshot IDs', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Synthetic cancellation', 'AbortError'))
    expect(await finishOracleEpmDataJob(auth, submitted, true, controller.signal)).toMatchObject({
      success: false,
      output: { jobId: '42' },
    })
    expect(
      await finishOracleEpmDataJob(
        auth,
        { status: 200, data: { status: -1, jobId: 0, action: 'IMPORT' } },
        true
      )
    ).toMatchObject({
      success: false,
      output: { jobId: '0' },
      error: expect.stringContaining('usable job ID'),
    })
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

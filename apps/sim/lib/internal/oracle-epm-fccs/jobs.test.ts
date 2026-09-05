/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FccsContext } from '@/lib/internal/oracle-epm-fccs/context'
import {
  classifyFccsJob,
  readFccsJob,
  submitFccsJob,
  waitForFccsJob,
} from '@/lib/internal/oracle-epm-fccs/jobs'

function context(request = vi.fn()): FccsContext {
  return { client: { request } as never }
}
const response = (status: number, ids: object = { jobID: 42 }) => ({
  data: { ...ids, status, details: null },
})
describe('FCCS job lifecycle through foundation polling', () => {
  afterEach(() => vi.useRealTimers())
  it.each([-1, 2])('keeps status %s pending', (status) =>
    expect(classifyFccsJob({ jobId: '42', status })).toEqual({ state: 'pending' })
  )
  it.each([1, 3, 4, 2147483647, 99])(
    'returns terminal failure status %s with diagnostics',
    async (status) => {
      const result = await waitForFccsJob(
        context(vi.fn().mockResolvedValue(response(status))),
        'Close',
        '42',
        30
      )
      expect(result).toMatchObject({ success: false, output: { jobId: '42', status, attempts: 1 } })
    }
  )
  it('submits once and returns in-progress without polling or changing RTP casing', async () => {
    const request = vi.fn().mockResolvedValue(response(-1))
    const parameters = { 'RTP.Entity': 'North & West', NestedRule: { 'RTP.Year': 'FY26' } }
    const result = await submitFccsJob(
      context(request),
      'Close',
      'RULESET',
      'Tenant Rules',
      parameters
    )
    expect(result).toMatchObject({ success: true, output: { jobId: '42', status: -1 } })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1].json).toEqual({
      jobType: 'RULESET',
      jobName: 'Tenant Rules',
      parameters,
    })
  })
  it('polls through cancel-pending to success with normalized IDs', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(-1))
      .mockResolvedValueOnce(response(2, { jobId: 42 }))
      .mockResolvedValueOnce(response(0))
    const pending = waitForFccsJob(context(request), 'Close', '42', 30)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({
      success: true,
      output: { jobId: '42', status: 0, attempts: 3 },
    })
  })
  it('rejects mismatched execution IDs', async () => {
    await expect(
      readFccsJob(context(vi.fn().mockResolvedValue(response(0, { jobId: 43 }))), 'Close', '42')
    ).rejects.toThrow('different job ID')
  })
  it('does not start another poll that would consume the cleanup deadline', async () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    const request = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(startedAt + 950)
      return response(-1)
    })
    await expect(waitForFccsJob(context(request), 'Close', '42', 1)).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('cancels an in-flight status read and does not interpret a late success', async () => {
    const controller = new AbortController()
    const request = vi.fn().mockImplementation(async (_endpoint, options) => {
      controller.abort(new DOMException('stopped', 'AbortError'))
      expect(options.signal.aborted).toBe(true)
      return response(0)
    })
    await expect(
      waitForFccsJob({ ...context(request), signal: controller.signal }, 'Close', '42', 30)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

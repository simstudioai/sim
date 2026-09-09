/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn(), externalEnqueue: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({
  getInlineJobQueue: async () => ({ enqueue: mocks.enqueue }),
  getJobQueue: async () => ({ enqueue: mocks.externalEnqueue }),
}))
vi.mock('@/lib/slack-search/handlers/search-message', () => ({
  handleSlackSearchMessage: mocks.run,
}))

import { enqueueSlackSearch } from '@/lib/slack-search/queue'

const job = { turnId: 'turn1', installationId: 'i1' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.enqueue.mockResolvedValue('id')
})
describe('Slack Search queue', () => {
  it('retries dispatch with unique wake IDs and never retries execution', async () => {
    await enqueueSlackSearch(job)
    await enqueueSlackSearch(job)
    for (const args of mocks.enqueue.mock.calls) {
      expect(args).toEqual([
        'slack-search',
        expect.any(Object),
        expect.objectContaining({
          jobId: expect.stringMatching(/^slack-search:turn1:/),
          maxAttempts: 1,
          maxDurationSeconds: 210,
          concurrencyKey: 'i1',
          concurrencyLimit: 2,
        }),
      ])
    }
  })
  it('runs in the app process even when the default queue has an external worker', async () => {
    const signal = new AbortController().signal
    await enqueueSlackSearch(job)
    await mocks.enqueue.mock.calls[0][2].runner(job, signal)
    expect(mocks.run).toHaveBeenCalledWith(job, signal)
    expect(mocks.externalEnqueue).not.toHaveBeenCalled()
  })
  it('propagates enqueue failures so ingress can request a retry', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('unavailable'))
    await expect(enqueueSlackSearch(job)).rejects.toThrow('unavailable')
  })
})

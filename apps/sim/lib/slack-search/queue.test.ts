/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: async () => ({ enqueue: mocks.enqueue }) }))
vi.mock('@/lib/slack-search/handlers/search-message', () => ({
  handleSlackSearchMessage: mocks.run,
}))

import { enqueueSlackSearch } from '@/lib/slack-search/queue'
import type { SlackSearchJob } from '@/lib/slack-search/types'

const job: SlackSearchJob = {
  installationId: 'i1',
  revision: 'r1',
  credentialId: 'c1',
  credentialVersion: 'v1',
  receivedAt: Date.now(),
  message: {
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    channelId: 'D1',
    userId: 'U1',
    query: 'query',
    queryTooLong: false,
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.enqueue.mockResolvedValue('id')
})
describe('Slack Search queue', () => {
  it('uses one stable installation/event ID across Slack retries with no automatic replay', async () => {
    await enqueueSlackSearch(job)
    await enqueueSlackSearch({ ...job, receivedAt: Date.now() + 1000 })
    for (const args of mocks.enqueue.mock.calls) {
      expect(args).toEqual([
        'slack-search',
        expect.any(Object),
        expect.objectContaining({
          jobId: 'slack-search:i1:Ev1',
          maxAttempts: 1,
          maxDurationSeconds: 60,
          concurrencyKey: 'i1',
          concurrencyLimit: 2,
        }),
      ])
    }
  })
  it('supplies the same handler to the database runner', async () => {
    const signal = new AbortController().signal
    await enqueueSlackSearch(job)
    await mocks.enqueue.mock.calls[0][2].runner(job, signal)
    expect(mocks.run).toHaveBeenCalledWith(job, signal)
  })
  it('propagates enqueue failures so ingress can request a retry', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('unavailable'))
    await expect(enqueueSlackSearch(job)).rejects.toThrow('unavailable')
  })
})

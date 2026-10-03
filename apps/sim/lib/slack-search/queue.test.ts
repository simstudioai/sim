import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ enqueue: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)
vi.mock('@/lib/slack-search/handlers/search-message', () => ({
  handleSlackSearchMessage: hoisted.run,
}))

import { enqueueSlackSearch } from '@/lib/slack-search/queue'

const mocks = {
  ...hoisted,
  externalEnqueue: asyncJobsMockFns.mockJobQueue.enqueue,
}
asyncJobsMockFns.mockGetInlineJobQueue.mockImplementation(async () => ({
  ...asyncJobsMockFns.mockJobQueue,
  enqueue: mocks.enqueue,
}))

const job = { turnId: 'turn1', installationId: 'i1' }
beforeEach(() => {
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
})

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

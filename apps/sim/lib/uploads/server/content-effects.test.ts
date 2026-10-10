import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), reconcile: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  processWorkspaceFileStorageCleanupsNow: mocks.cleanup,
}))
vi.mock('@/lib/uploads/server/live-doc-outbox', () => ({
  processFileLiveDocReconciliationNow: mocks.reconcile,
}))

import { finishFileContentEffects } from '@/lib/uploads/server/content-effects'

const effects = { cleanupIds: [], liveDocEventId: 'event-1' }
describe('committed file reconciliation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cleanup.mockResolvedValue(undefined)
  })
  it.each(['completed', 'pending', 'processing', 'lease_lost'])(
    'allows a %s result to finish or retry durably',
    async (status) => {
      mocks.reconcile.mockResolvedValue(status)
      await expect(finishFileContentEffects(effects, {})).resolves.toBeUndefined()
    }
  )
  it.each(['dead_letter', 'not_found'])('propagates a terminal %s result', async (status) => {
    mocks.reconcile.mockResolvedValue(status)
    await expect(finishFileContentEffects(effects, {})).rejects.toThrow(status)
  })
  it('retains the explicit defer policy for a terminal result', async () => {
    mocks.reconcile.mockResolvedValue('dead_letter')
    await expect(finishFileContentEffects(effects, {}, 'defer')).resolves.toBeUndefined()
  })
})

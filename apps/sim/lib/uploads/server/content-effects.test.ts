import { createLogger } from '@sim/logger'
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
    mocks.cleanup.mockResolvedValue(undefined)
  })
  it.each(['completed', 'pending', 'processing', 'lease_lost'])(
    'allows a %s result to finish or retry durably',
    async (status) => {
      mocks.reconcile.mockResolvedValue(status)
      await expect(finishFileContentEffects(effects, {})).resolves.toBeUndefined()
    }
  )
  it.each(['dead_letter', 'not_found'])(
    'reports a terminal %s result without failing the committed write',
    async (status) => {
      mocks.reconcile.mockResolvedValue(status)
      await expect(finishFileContentEffects(effects, {})).resolves.toBeUndefined()
      expect(createLogger('FileContentEffects').error).toHaveBeenCalledWith(
        'Committed file live-document reconciliation requires intervention',
        expect.objectContaining({ eventId: 'event-1', result: status })
      )
    }
  )
  it('reports an inline processing exception without failing the committed write', async () => {
    mocks.reconcile.mockRejectedValue(new Error('database unavailable'))
    await expect(finishFileContentEffects(effects, {})).resolves.toBeUndefined()
    expect(createLogger('FileContentEffects').error).toHaveBeenCalledWith(
      'Committed file live-document reconciliation failed inline',
      expect.objectContaining({ eventId: 'event-1' })
    )
  })
})

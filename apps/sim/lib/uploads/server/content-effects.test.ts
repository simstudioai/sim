import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  reconcile: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox', () => ({
  processWorkspaceFileStorageCleanupsNow: mocks.cleanup,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox', () => ({
  processWorkspaceFileLiveDocReconciliationNow: mocks.reconcile,
}))

const logger = getMockLogger('FileContentEffects')

import { finishFileContentEffects } from '@/lib/uploads/server/content-effects'

const effects = { cleanupIds: ['cleanup-1'], liveDocEventId: 'event-1' }
describe('committed file reconciliation policy', () => {
  beforeEach(() => {
    mocks.cleanup.mockResolvedValue(undefined)
  })
  it.each(['completed', 'pending', 'processing', 'lease_lost'])(
    'allows a %s result to finish or retry durably',
    async (status) => {
      mocks.reconcile.mockResolvedValue(status)
      await expect(finishFileContentEffects(effects, { fileId: 'file-1' })).resolves.toBeUndefined()
      expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(['cleanup-1'], { fileId: 'file-1' })
      expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('event-1')
      expect(logger.error).not.toHaveBeenCalled()
      if (status === 'completed') expect(logger.warn).not.toHaveBeenCalled()
      else
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
          'Live document reconciliation remains pending',
          { fileId: 'file-1', eventId: 'event-1', result: status }
        )
    }
  )
  it.each(['dead_letter', 'not_found'])(
    'reports a terminal %s result without failing the committed write',
    async (status) => {
      mocks.reconcile.mockResolvedValue(status)
      await expect(finishFileContentEffects(effects, { fileId: 'file-1' })).resolves.toBeUndefined()
      expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(['cleanup-1'], { fileId: 'file-1' })
      expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('event-1')
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        'Committed file live-document reconciliation requires intervention',
        { fileId: 'file-1', eventId: 'event-1', result: status }
      )
    }
  )
  it('reports an inline processing exception without failing the committed write', async () => {
    mocks.reconcile.mockRejectedValue(new Error('database unavailable'))
    await expect(finishFileContentEffects(effects, { fileId: 'file-1' })).resolves.toBeUndefined()
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(['cleanup-1'], { fileId: 'file-1' })
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith('event-1')
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Committed file live-document reconciliation failed inline',
      expect.objectContaining({
        fileId: 'file-1',
        eventId: 'event-1',
        error: expect.objectContaining({ message: 'database unavailable' }),
      })
    )
  })
})

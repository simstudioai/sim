import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  reconcile: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/file-storage-cleanup-outbox', () => ({
  processWorkspaceFileStorageCleanupsNow: mocks.cleanup,
}))
vi.mock('@/lib/uploads/server/live-doc-outbox', () => ({
  processFileLiveDocReconciliationNow: mocks.reconcile,
}))

import { finishFileContentEffects } from '@/lib/uploads/server/content-effects'

describe('committed file content effects', () => {
  it('resolves when inline live-document reconciliation throws, leaving the outbox to retry', async () => {
    mocks.cleanup.mockResolvedValue(undefined)
    mocks.reconcile.mockRejectedValue(new Error('database unavailable'))
    await expect(
      finishFileContentEffects(
        { cleanupIds: ['cleanup-1'], liveDocEventId: 'event-1' },
        { fileId: 'file-1' }
      )
    ).resolves.toBeUndefined()
  })
})

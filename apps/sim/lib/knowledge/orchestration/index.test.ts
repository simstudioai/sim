/**
 * @vitest-environment node
 *
 * `restoreKnowledgeBase` calls `assertResourceMutable('knowledge_base', id)` before
 * restoring -- this correctly evaluates both the KB's own `locked` flag and its
 * (unchanged on restore) containing folder chain, since restore doesn't change
 * folderId. Guards that a `ResourceLockedError` thrown from `restoreKnowledgeBase`
 * surfaces through `performRestoreKnowledgeBase` as `errorCode: 'locked'` (423).
 */
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { auditMock, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRestoreKnowledgeBase } = vi.hoisted(() => ({
  mockRestoreKnowledgeBase: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/knowledge/service', () => {
  class KnowledgeBaseConflictErrorStub extends Error {}
  return {
    restoreKnowledgeBase: mockRestoreKnowledgeBase,
    KnowledgeBaseConflictError: KnowledgeBaseConflictErrorStub,
  }
})

import { performRestoreKnowledgeBase } from '@/lib/knowledge/orchestration'

describe('performRestoreKnowledgeBase — resource-lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      { id: 'kb-1', name: 'KB 1', workspaceId: 'ws-1', userId: 'user-1' },
    ])
  })

  it('returns a 423 (locked) when the knowledge base itself is directly locked', async () => {
    mockRestoreKnowledgeBase.mockRejectedValueOnce(
      new ResourceLockedError('knowledge_base', false, 'Knowledge base is locked')
    )

    const result = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'locked' })
  })

  it('returns a 423 (locked, inherited) when the knowledge base is restored into a folder that is now locked', async () => {
    mockRestoreKnowledgeBase.mockRejectedValueOnce(
      new ResourceLockedError(
        'knowledge_base',
        true,
        'Knowledge base is locked by its containing folder'
      )
    )

    const result = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'locked' })
  })

  it('restores successfully when unlocked', async () => {
    mockRestoreKnowledgeBase.mockResolvedValueOnce(undefined)

    const result = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(mockRestoreKnowledgeBase).toHaveBeenCalledWith('kb-1', expect.any(String))
  })
})

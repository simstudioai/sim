/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordAudit, mockRestoreKnowledgeBase } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn(),
  mockRestoreKnowledgeBase: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { KNOWLEDGE_BASE_RESTORED: 'knowledge_base.restored' },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/knowledge/service', () => ({ restoreKnowledgeBase: mockRestoreKnowledgeBase }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { performRestoreKnowledgeBase } from '@/lib/knowledge/orchestration/restore'

const ARCHIVED = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1', userId: 'owner' }

describe('performRestoreKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterAll(resetDbChainMock)

  it('audits the restore against the acting user', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([ARCHIVED])
    mockRestoreKnowledgeBase.mockResolvedValue(undefined)

    const outcome = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      source: 'ui',
      requestId: 'req-1',
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', resourceId: 'kb-1', workspaceId: 'ws-1' })
    )
  })

  it('reports a knowledge base that is not archived as a conflict', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([ARCHIVED])
    mockRestoreKnowledgeBase.mockRejectedValue(
      new OrchestrationError('conflict', 'Knowledge base is not archived')
    )

    const outcome = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      source: 'ui',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('reports bad input as validation, which the narrow local alias could not express', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([ARCHIVED])
    mockRestoreKnowledgeBase.mockRejectedValue(
      new OrchestrationError('validation', 'Folder not found in this workspace')
    )

    const outcome = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      source: 'ui',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
  })

  it('reports a knowledge base that does not exist as not found', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const outcome = await performRestoreKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      userId: 'user-1',
      source: 'ui',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'not_found' })
    expect(mockRestoreKnowledgeBase).not.toHaveBeenCalled()
  })
})

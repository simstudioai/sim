import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockCreateKnowledgeBase,
  mockDeleteKnowledgeBase,
  mockRecordAudit,
  mockUpdateKnowledgeBase,
} = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockCreateKnowledgeBase: vi.fn(),
  mockDeleteKnowledgeBase: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockUpdateKnowledgeBase: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
    KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
    KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
  },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseCreated: vi.fn(), knowledgeBaseDeleted: vi.fn() },
}))
vi.mock('@/lib/knowledge/embeddings', () => ({
  getConfiguredKbEmbedding: () => ({ model: 'text-embedding-3-small', dimensions: 1536 }),
}))
vi.mock('@/lib/knowledge/service', () => ({
  createKnowledgeBase: mockCreateKnowledgeBase,
  deleteKnowledgeBase: mockDeleteKnowledgeBase,
  updateKnowledgeBase: mockUpdateKnowledgeBase,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performCreateKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration/knowledge-bases'

const CREATED = { id: 'kb-1', name: 'Docs', description: null, workspaceId: 'ws-1' }

describe('performCreateKnowledgeBase', () => {
  beforeEach(() => {
    mockCreateKnowledgeBase.mockResolvedValue(CREATED)
  })

  it('classifies a duplicate name as a conflict, not bad input', async () => {
    mockCreateKnowledgeBase.mockRejectedValue(
      new OrchestrationError('conflict', 'A knowledge base named "Docs" already exists')
    )

    const outcome = await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'ui',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('keeps an unclassified failure internal and records nothing', async () => {
    mockCreateKnowledgeBase.mockRejectedValue(new Error('connection terminated'))

    const outcome = await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'ui',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeBase', () => {
  beforeEach(() => {
    mockUpdateKnowledgeBase.mockResolvedValue({ ...CREATED, name: 'Renamed' })
  })

  it('always forwards the actor, so a workspace move is authorized not rejected', async () => {
    await performUpdateKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      source: 'api',
      updates: { workspaceId: 'ws-2' },
    })

    // The v1 and v2 routes used to omit `actorUserId`, which the service rejects
    // outright on a workspace change.
    expect(mockUpdateKnowledgeBase).toHaveBeenCalledWith(
      'kb-1',
      { workspaceId: 'ws-2' },
      expect.any(String),
      { actorUserId: 'user-1' }
    )
  })
})

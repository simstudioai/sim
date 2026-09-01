/**
 * @vitest-environment node
 */
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
  EMBEDDING_DIMENSIONS: 1536,
  getConfiguredEmbeddingModel: () => 'text-embedding-3-small',
}))
vi.mock('@/lib/knowledge/service', () => ({
  createKnowledgeBase: mockCreateKnowledgeBase,
  deleteKnowledgeBase: mockDeleteKnowledgeBase,
  updateKnowledgeBase: mockUpdateKnowledgeBase,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/knowledge/constants'
import {
  performCreateKnowledgeBase,
  performDeleteKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration/knowledge-bases'

const CREATED = { id: 'kb-1', name: 'Docs', description: null, workspaceId: 'ws-1' }

describe('performCreateKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateKnowledgeBase.mockResolvedValue(CREATED)
  })

  it('applies one chunking default for every caller', async () => {
    await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'agent',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    // The agent used to default minSize to 1 against the API's 100, so the same
    // document chunked differently depending on who created the knowledge base.
    expect(mockCreateKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ chunkingConfig: { ...DEFAULT_CHUNKING_CONFIG } }),
      expect.any(String)
    )
  })

  it('lets a caller override individual chunking fields', async () => {
    await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'api',
      workspaceId: 'ws-1',
      name: 'Docs',
      chunkingConfig: { maxSize: 512 },
    })

    expect(mockCreateKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkingConfig: { ...DEFAULT_CHUNKING_CONFIG, maxSize: 512 },
      }),
      expect.any(String)
    )
  })

  it('audits an agent-created knowledge base, which the copilot path never did', async () => {
    await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'agent',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        resourceId: 'kb-1',
        workspaceId: 'ws-1',
        metadata: expect.objectContaining({ source: 'agent' }),
      })
    )
  })

  it('carries request provenance into the audit row', async () => {
    const request = new Request('https://sim.ai', { headers: { 'user-agent': 'curl/8' } })

    await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'ui',
      workspaceId: 'ws-1',
      name: 'Docs',
      request,
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ request }))
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
    vi.clearAllMocks()
    mockUpdateKnowledgeBase.mockResolvedValue({ ...CREATED, name: 'Renamed' })
  })

  it('rejects an update that names nothing before touching the service', async () => {
    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      source: 'api',
      updates: { name: undefined, description: undefined },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockUpdateKnowledgeBase).not.toHaveBeenCalled()
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

  it('files the audit against the destination workspace on a move', async () => {
    await performUpdateKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      source: 'ui',
      updates: { workspaceId: 'ws-2' },
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-2' }))
  })

  it('classifies a rejected folder as bad input', async () => {
    mockUpdateKnowledgeBase.mockRejectedValue(
      new OrchestrationError('validation', 'Folder not found in this workspace')
    )

    const outcome = await performUpdateKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      source: 'ui',
      updates: { folderId: 'folder-elsewhere' },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
  })
})

describe('performDeleteKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteKnowledgeBase.mockResolvedValue(undefined)
  })

  it('audits the archive against the acting user', async () => {
    const outcome = await performDeleteKnowledgeBase({
      knowledgeBase: { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' },
      userId: 'user-1',
      source: 'agent',
      requestId: 'req-1',
    })

    expect(outcome.success).toBe(true)
    expect(mockDeleteKnowledgeBase).toHaveBeenCalledWith('kb-1', 'req-1', {
      assertedWorkspaceId: undefined,
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', resourceId: 'kb-1' })
    )
  })

  it('records nothing when the archive fails', async () => {
    mockDeleteKnowledgeBase.mockRejectedValue(new Error('deadlock detected'))

    const outcome = await performDeleteKnowledgeBase({
      knowledgeBase: { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' },
      userId: 'user-1',
      source: 'ui',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

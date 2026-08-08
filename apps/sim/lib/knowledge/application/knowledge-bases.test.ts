/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolveKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveFolderPath: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  listRecords: vi.fn(),
  loadFolderIndex: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
    KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
    KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
  },
  AuditResourceType: { KNOWLEDGE_BASE: 'knowledge_base' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
}))

vi.mock('@/lib/knowledge/application/folder-paths', () => ({
  resolveKnowledgeFolderPath: mocks.resolveFolderPath,
  knowledgeFolderPathForId: () => '/',
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getConfiguredEmbeddingModel: () => 'text-embedding-3-small',
}))

vi.mock('@/lib/knowledge/service', () => ({
  createAuthorizedKnowledgeBase: mocks.createRecord,
  updateKnowledgeBase: mocks.updateRecord,
  deleteKnowledgeBase: mocks.deleteRecord,
  getWorkspaceKnowledgeBases: mocks.listRecords,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createKnowledgeBase,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'billing-owner-1',
  name: 'Docs',
  description: null,
  tokenCount: 0,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  workspaceId: 'workspace-1',
  folderId: null,
  docCount: 0,
  connectorTypes: [],
}

describe('knowledge base application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(context)
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveFolderPath.mockResolvedValue({
      folderId: null,
      index: { pathById: new Map(), idByPath: new Map(), rowById: new Map() },
    })
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map() })
    mocks.createRecord.mockResolvedValue(knowledgeBase)
    mocks.updateRecord.mockResolvedValue({ ...knowledgeBase, name: 'Renamed' })
  })

  it('rejects an insufficient role before the protected mutation', async () => {
    mocks.resolvePermission.mockResolvedValueOnce('read')

    await expect(
      createKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', name: 'Docs' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.createRecord).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('uses billing ownership only for the workspace-key compatibility column', async () => {
    await createKnowledgeBase.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      },
      input: { workspaceId: 'workspace-1', name: 'Docs', source: 'v2' },
    })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1', workspaceId: 'workspace-1' }),
      expect.any(String)
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.create',
          actor: {
            kind: 'workspace_api_key',
            keyId: 'workspace-key-1',
            workspaceId: 'workspace-1',
          },
        }),
      })
    )
  })

  it('conceals a canonical scope mismatch and never audits it', async () => {
    mocks.resolveKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    await expect(
      readKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('propagates infrastructure failures without audit', async () => {
    const failure = new Error('database unavailable')
    mocks.createRecord.mockRejectedValueOnce(failure)

    await expect(
      createKnowledgeBase.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', name: 'Docs' },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('carries the canonical workspace predicate into the locked update', async () => {
    await updateKnowledgeBaseOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        name: 'Renamed',
      },
    })

    expect(mocks.updateRecord).toHaveBeenCalledWith(
      'knowledge-1',
      expect.objectContaining({ name: 'Renamed' }),
      expect.any(String),
      { assertedWorkspaceId: 'workspace-1' }
    )
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  loadAuthorizationWorkspace: vi.fn(),
  resolveKnowledgeBase: vi.fn(),
  resolveArchivedKnowledgeBase: vi.fn(),
  resolvePermission: vi.fn(),
  resolveAccess: vi.fn(),
  createAccessProvider: vi.fn(),
  attachConnectors: vi.fn(),
  resolveFolderPath: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  listRecords: vi.fn(),
  getRecord: vi.fn(),
  performUpdate: vi.fn(),
  performDelete: vi.fn(),
  performRestore: vi.fn(),
  loadFolderIndex: vi.fn(),
  recordAudit: vi.fn(),
  knowledgeBaseDeleted: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
    KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
    KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
    KNOWLEDGE_BASE_RESTORED: 'knowledge_base.restored',
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

vi.mock('@/lib/knowledge/access/scope', () => ({
  createKnowledgeAccessProvider: mocks.createAccessProvider,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDeleted: mocks.knowledgeBaseDeleted },
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
  resolveFolderPathFilter: (index: { idByPath: Map<string, string> }, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' }
    if (path === '/') return { kind: 'folder', folderId: null }
    const folderId = index.idByPath.get(path)
    return folderId === undefined ? { kind: 'noMatch' } : { kind: 'folder', folderId }
  },
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  loadKnowledgeWorkspaceAuthorizationContext: mocks.loadAuthorizationWorkspace,
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveArchivedKnowledgeBaseContext: mocks.resolveArchivedKnowledgeBase,
}))

vi.mock('@/lib/knowledge/application/folder-paths', () => ({
  resolveKnowledgeFolderPath: mocks.resolveFolderPath,
  knowledgeFolderPathForId: () => '/',
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  getConfiguredKbEmbedding: () => ({ model: 'text-embedding-3-small', dimensions: 1536 }),
}))

vi.mock('@/lib/knowledge/service', () => ({
  createAuthorizedKnowledgeBase: mocks.createRecord,
  updateKnowledgeBase: mocks.updateRecord,
  deleteKnowledgeBase: mocks.deleteRecord,
  getKnowledgeBaseById: mocks.getRecord,
  getWorkspaceKnowledgeBases: mocks.listRecords,
  attachKnowledgeBaseConnectors: mocks.attachConnectors,
}))

vi.mock('@/lib/knowledge/orchestration', () => ({
  performUpdateKnowledgeBase: mocks.performUpdate,
  performDeleteKnowledgeBase: mocks.performDelete,
  performRestoreKnowledgeBase: mocks.performRestore,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  bulkDeleteKnowledgeBases,
  createKnowledgeBase,
  listInternalKnowledgeBases,
  listKnowledgeBases,
  readInternalKnowledgeBase,
  readKnowledgeBase,
  updateInternalKnowledgeBase,
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
    mocks.resolveAccess.mockResolvedValue({ kind: 'workspace', tokens: ['workspace', 'public'] })
    mocks.createAccessProvider.mockReturnValue({ get: mocks.resolveAccess })
    mocks.attachConnectors.mockImplementation(async (kb) => kb)
    mocks.resolveWorkspace.mockResolvedValue(context)
    mocks.loadAuthorizationWorkspace.mockResolvedValue(context)
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
      access: { get: mocks.resolveAccess },
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveFolderPath.mockResolvedValue({
      folderId: null,
      index: { pathById: new Map(), idByPath: new Map(), rowById: new Map() },
    })
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map(), idByPath: new Map() })
    mocks.createRecord.mockResolvedValue(knowledgeBase)
    mocks.listRecords.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.getRecord.mockResolvedValue(knowledgeBase)
    mocks.resolveArchivedKnowledgeBase.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      restorableKnowledgeBase: {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
        deletedAt: new Date('2026-02-01T00:00:00Z'),
      },
    })
    mocks.performUpdate.mockResolvedValue({
      success: true,
      knowledgeBase: { ...knowledgeBase, name: 'Renamed' },
    })
    mocks.performDelete.mockResolvedValue({ success: true })
    mocks.performRestore.mockResolvedValue({ success: true, knowledgeBase })
    mocks.updateRecord.mockResolvedValue({ ...knowledgeBase, name: 'Renamed' })
    mocks.deleteRecord.mockResolvedValue(undefined)
  })

  it('authorizes a canonical workspace before listing its internal knowledge bases', async () => {
    await listInternalKnowledgeBases.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', scope: 'archived' },
    })

    expect(mocks.resolveWorkspace).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.listRecords).toHaveBeenCalledWith('workspace-1', 'archived', {
      access: expect.objectContaining({ get: mocks.resolveAccess }),
    })
  })

  it('rejects an archived Knowledge list bound to another trusted workspace before reading', async () => {
    await expect(
      listKnowledgeBases.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'copilot',
          subjectUserId: 'dual-workspace-user',
          workspaceId: 'workspace-b',
          delegationId: 'vfs-1',
          audience: 'sim:knowledge',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: { workspaceId: 'workspace-1', scope: 'archived' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.listRecords).not.toHaveBeenCalled()
  })

  it('rejects a workspace listing before reading when current access is insufficient', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      listInternalKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', scope: 'active' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listRecords).not.toHaveBeenCalled()
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

  it.each([null, 'organization-1'])(
    'conceals a knowledge base outside a workspace even from its creator: %s',
    async (organizationId) => {
      const scopedKnowledgeBase = {
        ...knowledgeBase,
        userId: 'user-1',
        workspaceId: null,
        organizationId,
      }
      mocks.getRecord.mockResolvedValueOnce(scopedKnowledgeBase)

      await expect(
        readInternalKnowledgeBase.execute({
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          input: { knowledgeBaseId: 'knowledge-1' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(mocks.loadAuthorizationWorkspace).not.toHaveBeenCalled()
    }
  )

  it('authorizes both canonical workspaces before moving a knowledge base', async () => {
    mocks.resolveWorkspace.mockResolvedValueOnce({ ...context, workspaceId: 'workspace-2' })

    await updateInternalKnowledgeBase.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: { knowledgeBaseId: 'knowledge-1', workspaceId: 'workspace-2' },
    })

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
    expect(mocks.performUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'knowledge-1',
        assertedWorkspaceId: 'workspace-1',
        updates: expect.objectContaining({ workspaceId: 'workspace-2' }),
      })
    )
  })

  it.each([null, ''])('rejects detaching a KB even for its owner: %s', async (workspaceId) => {
    await expect(
      updateInternalKnowledgeBase.execute({
        principal: { kind: 'session', userId: knowledgeBase.userId, sessionId: 'session-1' },
        /** @ts-expect-error Exercise a runtime caller bypassing the HTTP contract. */
        input: { knowledgeBaseId: knowledgeBase.id, workspaceId },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Workspace ID is required' })
    expect(mocks.performUpdate).not.toHaveBeenCalled()
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('refuses to move an unscoped knowledge base through a creator-authorized path', async () => {
    mocks.getRecord.mockResolvedValueOnce({ ...knowledgeBase, workspaceId: null })

    await expect(
      updateInternalKnowledgeBase.execute({
        principal: { kind: 'session', userId: knowledgeBase.userId, sessionId: 'session-1' },
        input: { knowledgeBaseId: knowledgeBase.id, workspaceId: 'workspace-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.performUpdate).not.toHaveBeenCalled()
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
  })

  it('conceals a cross-workspace bulk target before mutation for a dual-workspace subject', async () => {
    mocks.resolveKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    const result = await bulkDeleteKnowledgeBases.execute({
      principal: {
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'dual-workspace-user',
        workspaceId: 'workspace-1',
        delegationId: 'tool-call-1',
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: {
        assertedWorkspaceId: 'workspace-1',
        knowledgeBaseIds: ['workspace-2-knowledge'],
      },
    })

    expect(result).toMatchObject({ deleted: [], notFound: ['workspace-2-knowledge'] })
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'dual-workspace-user',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('audits completed knowledge base deletions before propagating infrastructure failure', async () => {
    const failure = new Error('knowledge store unavailable')
    mocks.resolveKnowledgeBase.mockImplementation(async ({ knowledgeBaseId }) => ({
      ...context,
      knowledgeBaseId,
      knowledgeBase: { ...knowledgeBase, id: knowledgeBaseId, name: knowledgeBaseId },
    }))
    mocks.deleteRecord.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)

    await expect(
      bulkDeleteKnowledgeBases.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        },
      })
    ).rejects.toBe(failure)

    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'knowledge-1' })
    )
    expect(mocks.knowledgeBaseDeleted).toHaveBeenCalledOnce()
  })
})

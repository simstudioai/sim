import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { knowledgeEmbeddingsMock } from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  resolveFolderPath: vi.fn(),
  performUpdate: vi.fn(),
  performDelete: vi.fn(),
  performRestore: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/application/folder-paths', () => ({
  resolveKnowledgeFolderPath: hoisted.resolveFolderPath,
  knowledgeFolderPathForId: () => '/',
}))

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)

vi.mock('@/lib/knowledge/orchestration', () => ({
  performUpdateKnowledgeBase: hoisted.performUpdate,
  performDeleteKnowledgeBase: hoisted.performDelete,
  performRestoreKnowledgeBase: hoisted.performRestore,
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

const mocks = {
  ...hoisted,
  createAccessProvider: knowledgeAccessScopeMockFns.mockCreateKnowledgeAccessProvider,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  createRecord: knowledgeServiceMockFns.mockCreateAuthorizedKnowledgeBase,
  updateRecord: knowledgeServiceMockFns.mockUpdateKnowledgeBase,
  deleteRecord: knowledgeServiceMockFns.mockDeleteKnowledgeBase,
  getRecord: knowledgeServiceMockFns.mockGetKnowledgeBaseById,
  listRecords: knowledgeServiceMockFns.mockGetWorkspaceKnowledgeBases,
  attachConnectors: knowledgeServiceMockFns.mockAttachKnowledgeBaseConnectors,
}

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
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue(context)
    knowledgeContextsMockFns.mockLoadKnowledgeWorkspaceAuthorizationContext.mockResolvedValue(
      context
    )
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockResolvedValue({
      ...context,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBase,
      access: { get: mocks.resolveAccess },
    })
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('write')
    mocks.resolveFolderPath.mockResolvedValue({
      folderId: null,
      index: { pathById: new Map(), idByPath: new Map(), rowById: new Map() },
    })
    mocks.loadFolderIndex.mockResolvedValue({ pathById: new Map(), idByPath: new Map() })
    mocks.createRecord.mockResolvedValue(knowledgeBase)
    mocks.listRecords.mockResolvedValue({ data: [], nextCursorKeys: null })
    mocks.getRecord.mockResolvedValue(knowledgeBase)
    knowledgeContextsMockFns.mockResolveArchivedKnowledgeBaseContext.mockResolvedValue({
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
      principal: createSessionPrincipal(),
      input: { workspaceId: 'workspace-1', scope: 'archived' },
    })

    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    })
    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).toHaveBeenCalledWith(
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

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.listRecords).not.toHaveBeenCalled()
  })

  it('rejects a workspace listing before reading when current access is insufficient', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValueOnce(null)

    await expect(
      listInternalKnowledgeBases.execute({
        principal: createSessionPrincipal(),
        input: { workspaceId: 'workspace-1', scope: 'active' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.listRecords).not.toHaveBeenCalled()
  })

  it('rejects an insufficient role before the protected mutation', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValueOnce('read')

    await expect(
      createKnowledgeBase.execute({
        principal: createSessionPrincipal(),
        input: { workspaceId: 'workspace-1', name: 'Docs' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.createRecord).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('uses billing ownership only for the workspace-key compatibility column', async () => {
    await createKnowledgeBase.execute({
      principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
      input: { workspaceId: 'workspace-1', name: 'Docs', source: 'v2' },
    })

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(mocks.createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-owner-1', workspaceId: 'workspace-1' }),
      expect.any(String)
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'knowledge.create',
          actor: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
        }),
      })
    )
  })

  it('conceals a canonical scope mismatch and never audits it', async () => {
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )

    await expect(
      readKnowledgeBase.execute({
        principal: createSessionPrincipal(),
        input: { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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
          principal: createSessionPrincipal(),
          input: { knowledgeBaseId: 'knowledge-1' },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(
        knowledgeContextsMockFns.mockLoadKnowledgeWorkspaceAuthorizationContext
      ).not.toHaveBeenCalled()
    }
  )

  it('authorizes both canonical workspaces before moving a knowledge base', async () => {
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValueOnce({
      ...context,
      workspaceId: 'workspace-2',
    })

    await updateInternalKnowledgeBase.execute({
      principal: createSessionPrincipal(),
      input: { knowledgeBaseId: 'knowledge-1', workspaceId: 'workspace-2' },
    })

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).toHaveBeenCalledTimes(2)
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
    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
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
    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).not.toHaveBeenCalled()
  })

  it('conceals a cross-workspace bulk target before mutation for a dual-workspace subject', async () => {
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockRejectedValueOnce(
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
    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).toHaveBeenCalledWith(
      'dual-workspace-user',
      'workspace-1',
      'organization-1',
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.deleteRecord).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('audits completed knowledge base deletions before propagating infrastructure failure', async () => {
    const failure = new Error('knowledge store unavailable')
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext.mockImplementation(
      async ({ knowledgeBaseId }) => ({
        ...context,
        knowledgeBaseId,
        knowledgeBase: { ...knowledgeBase, id: knowledgeBaseId, name: knowledgeBaseId },
      })
    )
    mocks.deleteRecord.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)

    await expect(
      bulkDeleteKnowledgeBases.execute({
        principal: createSessionPrincipal(),
        input: {
          assertedWorkspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        },
      })
    ).rejects.toBe(failure)

    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledOnce()
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'knowledge-1' })
    )
    expect(getMockPlatformEvent('knowledgeBaseDeleted')).toHaveBeenCalledOnce()
  })
})

/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeBase: vi.fn(),
  getDocument: vi.fn(),
  getDocumentById: vi.fn(),
  getTag: vi.fn(),
  getConnector: vi.fn(),
  loadWorkspace: vi.fn(),
  loadWorkspaceIncludingArchived: vi.fn(),
  createAccessProvider: vi.fn(() => ({
    get: async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] }),
  })),
}))

vi.mock('@/lib/knowledge/access/scope', () => ({
  createKnowledgeAccessProvider: mocks.createAccessProvider,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mocks.getKnowledgeBase,
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  getKnowledgeDocument: mocks.getDocument,
  getKnowledgeDocumentById: mocks.getDocumentById,
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getTagDefinitionById: mocks.getTag,
}))

vi.mock('@/lib/knowledge/connectors/service', () => ({
  getActiveKnowledgeConnectorReference: mocks.getConnector,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
  loadWorkspaceApplicationContext: mocks.loadWorkspaceIncludingArchived,
}))

import {
  loadKnowledgeWorkspaceAuthorizationContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeResourceContext,
  resolveActiveKnowledgeTagContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const knowledgeBase = { id: 'knowledge-1', workspaceId: 'workspace-1' }
const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

describe('knowledge application contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.loadWorkspaceIncludingArchived.mockResolvedValue(workspace)
  })

  it('uses the canonical active-workspace loader', async () => {
    await expect(resolveKnowledgeWorkspaceContext({ workspaceId: 'workspace-1' })).resolves.toBe(
      workspace
    )
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('uses the neutral canonical loader when archived workspace authorization is explicit', async () => {
    await expect(
      loadKnowledgeWorkspaceAuthorizationContext('workspace-1', { includeArchived: true })
    ).resolves.toBe(workspace)
    expect(mocks.loadWorkspaceIncludingArchived).toHaveBeenCalledWith('workspace-1', {
      includeArchived: true,
    })
  })

  it('conceals an inactive canonical workspace as knowledge-base absence', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' }, principal)
    ).rejects.toMatchObject({ code: 'not_found', message: 'Knowledge base not found' })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' }, principal)
    ).rejects.toBe(failure)
  })

  it('conceals an unscoped knowledge base even from its creator', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      id: 'unscoped-knowledge',
      userId: principal.userId,
      workspaceId: null,
      organizationId: null,
    })

    await expect(
      resolveActiveKnowledgeResourceContext({ knowledgeBaseId: 'unscoped-knowledge' }, principal)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.createAccessProvider).not.toHaveBeenCalled()
  })

  it('does not load child documents from an unscoped knowledge base', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      id: 'unscoped-knowledge',
      userId: principal.userId,
      workspaceId: null,
      organizationId: null,
    })

    await expect(
      resolveCanonicalActiveKnowledgeDocumentContext(
        { knowledgeBaseId: 'unscoped-knowledge', documentId: 'document-1' },
        principal
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getDocumentById).not.toHaveBeenCalled()
  })

  describe('canonical child resources', () => {
    beforeEach(() => {
      mocks.getKnowledgeBase.mockResolvedValue({
        id: 'knowledge-b',
        name: 'Workspace B docs',
        workspaceId: 'workspace-b',
      })
      mocks.getDocumentById.mockResolvedValue({
        id: 'document-b',
        knowledgeBaseId: 'knowledge-b',
      })
      mocks.getTag.mockResolvedValue({
        id: 'tag-b',
        knowledgeBaseId: 'knowledge-b',
      })
      mocks.getConnector.mockResolvedValue({
        id: 'connector-b',
        knowledgeBaseId: 'knowledge-b',
        connectorType: 'confluence',
        status: 'active',
      })
    })

    it('resolves the asserted parent and conceals a foreign document without loading it', async () => {
      await expect(
        resolveCanonicalActiveKnowledgeDocumentContext(
          {
            knowledgeBaseId: 'knowledge-b',
            documentId: 'document-b',
            assertedWorkspaceId: 'workspace-a',
          },
          principal
        )
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
      expect(mocks.getDocumentById).not.toHaveBeenCalled()
    })

    it('resolves a tag parent canonically before comparing the trusted workspace', async () => {
      await expect(
        resolveActiveKnowledgeTagContext(
          {
            tagDefinitionId: 'tag-b',
            assertedWorkspaceId: 'workspace-a',
          },
          principal
        )
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getTag).toHaveBeenCalledWith('tag-b')
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
    })

    it('resolves a connector parent canonically before comparing the trusted workspace', async () => {
      await expect(
        resolveActiveKnowledgeConnectorContext(
          {
            connectorId: 'connector-b',
            assertedWorkspaceId: 'workspace-a',
          },
          principal
        )
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getConnector).toHaveBeenCalledWith('connector-b')
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
    })
  })
})

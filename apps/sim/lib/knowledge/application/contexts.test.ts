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
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeTagContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
  resolveKnowledgeWorkspaceContext,
  loadKnowledgeWorkspaceAuthorizationContext,
} from '@/lib/knowledge/application/contexts'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const knowledgeBase = { id: 'knowledge-1', workspaceId: 'workspace-1' }

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
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Knowledge base not found' })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' })
    ).rejects.toBe(failure)
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

    it('resolves a document parent canonically before comparing the trusted workspace', async () => {
      await expect(
        resolveCanonicalActiveKnowledgeDocumentContext({
          knowledgeBaseId: 'knowledge-b',
          documentId: 'document-b',
          assertedWorkspaceId: 'workspace-a',
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getDocumentById).toHaveBeenCalledWith('document-b')
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
    })

    it('resolves a tag parent canonically before comparing the trusted workspace', async () => {
      await expect(
        resolveActiveKnowledgeTagContext({
          tagDefinitionId: 'tag-b',
          assertedWorkspaceId: 'workspace-a',
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getTag).toHaveBeenCalledWith('tag-b')
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
    })

    it('resolves a connector parent canonically before comparing the trusted workspace', async () => {
      await expect(
        resolveActiveKnowledgeConnectorContext({
          connectorId: 'connector-b',
          assertedWorkspaceId: 'workspace-a',
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(mocks.getConnector).toHaveBeenCalledWith('connector-b')
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('knowledge-b')
    })
  })
})

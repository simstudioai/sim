/**
 * @vitest-environment node
 */

import type { Principal } from '@sim/auth/principal'
import { member, organization } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeBase: vi.fn(),
  getKnowledgeBaseWithCounts: vi.fn(),
  getDocument: vi.fn(),
  getDocumentById: vi.fn(),
  getTag: vi.fn(),
  getConnector: vi.fn(),
  loadWorkspace: vi.fn(),
  loadWorkspaceIncludingArchived: vi.fn(),
  getOrganizationPermissionConfig: vi.fn(),
  createAccessProvider: vi.fn(() => ({
    get: async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] }),
    getForDocuments: vi.fn(async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] })),
    getForConnectors: vi.fn(async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] })),
  })),
}))

vi.mock('@/lib/knowledge/access/scope', () => ({
  createKnowledgeAccessProvider: mocks.createAccessProvider,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getActiveKnowledgeBaseReference: mocks.getKnowledgeBase,
  getKnowledgeBaseById: mocks.getKnowledgeBaseWithCounts,
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

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.getOrganizationPermissionConfig,
}))

import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  loadKnowledgeWorkspaceAuthorizationContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeChunkContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeResourceContext,
  resolveActiveKnowledgeTagContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

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
    resetDbChainMock()
    mocks.getOrganizationPermissionConfig.mockResolvedValue(null)
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mocks.getKnowledgeBaseWithCounts.mockResolvedValue({
      ...knowledgeBase,
      docCount: 3,
      tokenCount: 1536,
    })
    mocks.loadWorkspace.mockResolvedValue(workspace)
    mocks.loadWorkspaceIncludingArchived.mockResolvedValue(workspace)
  })

  it('selects only chunk identity before document authorization and never hydrates a denied chunk', async () => {
    queueTableRows(schemaMock.embedding, [
      { id: 'chunk-1', documentId: 'document-1', knowledgeBaseId: 'knowledge-1' },
    ])
    mocks.getDocumentById.mockResolvedValueOnce(null)
    await expect(
      resolveActiveKnowledgeChunkContext(
        { chunkId: 'chunk-1', documentId: 'document-1', knowledgeBaseId: 'knowledge-1' },
        principal
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(dbChainMockFns.select).toHaveBeenCalledExactlyOnceWith({
      id: schemaMock.embedding.id,
      documentId: schemaMock.embedding.documentId,
      knowledgeBaseId: schemaMock.embedding.knowledgeBaseId,
    })
  })

  it('resolves child-resource context without loading display counts', async () => {
    const context = await resolveActiveKnowledgeResourceContext(
      { knowledgeBaseId: 'knowledge-1', assertedWorkspaceId: 'workspace-1' },
      principal
    )

    expect(context.knowledgeBase).toEqual(knowledgeBase)
    expect(mocks.getKnowledgeBaseWithCounts).not.toHaveBeenCalled()
    expect(mocks.createAccessProvider).toHaveBeenCalledWith(principal, {
      workspaceId: 'workspace-1',
      knowledgeBaseIds: ['knowledge-1'],
    })
  })

  it('retains display counts in workspace knowledge-base detail context', async () => {
    const context = await resolveActiveKnowledgeBaseContext(
      { knowledgeBaseId: 'knowledge-1' },
      principal
    )

    expect(context.knowledgeBase).toMatchObject({ docCount: 3, tokenCount: 1536 })
    expect(mocks.getKnowledgeBase).not.toHaveBeenCalled()
  })

  it('conceals a missing or archived knowledge-base reference before loading its owner', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce(null)

    await expect(
      resolveActiveKnowledgeResourceContext({ knowledgeBaseId: 'archived' }, principal)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
    expect(mocks.createAccessProvider).not.toHaveBeenCalled()
  })

  it('conceals an organization reference outside the asserted organization', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      id: 'org-index',
      workspaceId: null,
      organizationId: 'org-canonical',
    })

    await expect(
      resolveActiveKnowledgeResourceContext(
        { knowledgeBaseId: 'org-index', assertedOrganizationId: 'org-other' },
        principal
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.createAccessProvider).not.toHaveBeenCalled()
  })

  it('conceals a reference with conflicting owners', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      ...knowledgeBase,
      organizationId: 'org-canonical',
    })

    await expect(
      resolveActiveKnowledgeResourceContext({ knowledgeBaseId: 'knowledge-1' }, principal)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.createAccessProvider).not.toHaveBeenCalled()
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

  describe.each(['tag', 'connector'] as const)('organization-scoped %s context', (kind) => {
    const execute = vi.fn(async () => 'authorized')
    const useCase = defineAuthorizedKnowledgeUseCase({
      operation:
        kind === 'tag' ? knowledgeOperations.readTagUsage : knowledgeOperations.readConnector,
      resolveContext: ({
        input,
        principal: actingPrincipal,
      }: {
        input: { assertedOrganizationId?: string }
        principal: Principal
      }) =>
        kind === 'tag'
          ? resolveActiveKnowledgeTagContext(
              { ...input, tagDefinitionId: 'tag-1' },
              actingPrincipal
            )
          : resolveActiveKnowledgeConnectorContext(
              { ...input, connectorId: 'connector-1' },
              actingPrincipal
            ),
      execute,
    })

    function queueOrganization(organizationId: string, isMember = true) {
      mocks.getKnowledgeBase.mockResolvedValue({
        id: 'org-index',
        workspaceId: null,
        organizationId,
      })
      queueTableRows(organization, [{ id: organizationId }])
      queueTableRows(member, isMember ? [{ role: 'member' }] : [])
    }

    beforeEach(() => {
      mocks.getTag.mockResolvedValue({ id: 'tag-1', knowledgeBaseId: 'org-index' })
      mocks.getConnector.mockResolvedValue({
        id: 'connector-1',
        knowledgeBaseId: 'org-index',
        connectorType: 'confluence',
        status: 'active',
      })
    })

    it('rejects a mismatched assertion even when the caller belongs to both organizations', async () => {
      for (const organizationId of ['org-a', 'org-b']) {
        queueOrganization(organizationId)
        await expect(
          useCase.execute({ principal, input: { assertedOrganizationId: organizationId } })
        ).resolves.toBe('authorized')
        expect(mocks.getOrganizationPermissionConfig).toHaveBeenLastCalledWith(organizationId)
      }
      expect(execute).toHaveBeenCalledTimes(2)
      vi.clearAllMocks()

      queueOrganization('org-b')
      await expect(
        useCase.execute({ principal, input: { assertedOrganizationId: 'org-a' } })
      ).rejects.toMatchObject({ code: 'not_found', message: 'Knowledge base not found' })

      expect(kind === 'tag' ? mocks.getTag : mocks.getConnector).toHaveBeenCalledWith(`${kind}-1`)
      expect(mocks.getKnowledgeBase).toHaveBeenCalledWith('org-index')
      expect(mocks.createAccessProvider).not.toHaveBeenCalled()
      expect(mocks.getOrganizationPermissionConfig).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
    })

    it('authorizes the canonical organization when no organization is asserted', async () => {
      queueOrganization('org-b')
      await expect(useCase.execute({ principal, input: {} })).resolves.toBe('authorized')
      expect(mocks.getOrganizationPermissionConfig).toHaveBeenCalledWith('org-b')
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          principal,
          context: expect.objectContaining({
            organizationId: 'org-b',
            knowledgeBaseId: 'org-index',
          }),
        })
      )

      execute.mockClear()
      queueOrganization('org-b', false)
      await expect(useCase.execute({ principal, input: {} })).rejects.toMatchObject({
        code: 'not_found',
        message: 'Organization not found',
      })
      expect(execute).not.toHaveBeenCalled()
    })
  })
})

import type { Principal } from '@sim/auth/principal'
import { member, organization } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import {
  knowledgeDocumentsServiceMock,
  knowledgeDocumentsServiceMockFns,
} from '@sim/testing/mocks/knowledge-documents-service.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getConnector: vi.fn(),
}))

vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

vi.mock('@/lib/knowledge/connectors/service', () => ({
  getActiveKnowledgeConnectorReference: hoisted.getConnector,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveActiveKnowledgeChunkContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeResourceContext,
  resolveActiveKnowledgeTagContext,
  resolveCanonicalActiveKnowledgeDocumentContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

const mocks = {
  ...hoisted,
  getKnowledgeBase: knowledgeServiceMockFns.mockGetActiveKnowledgeBaseReference,
  getKnowledgeBaseWithCounts: knowledgeServiceMockFns.mockGetKnowledgeBaseById,
  getDocument: knowledgeDocumentsServiceMockFns.mockGetKnowledgeDocument,
  getDocumentById: knowledgeDocumentsServiceMockFns.mockGetKnowledgeDocumentById,
  getTag: knowledgeTagsServiceMockFns.mockGetTagDefinitionById,
  createAccessProvider: knowledgeAccessScopeMockFns.mockCreateKnowledgeAccessProvider,
}
mocks.createAccessProvider.mockImplementation(() => ({
  get: async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] }),
  getForDocuments: vi.fn(async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] })),
  getForConnectors: vi.fn(async () => ({ kind: 'workspace', tokens: ['pub', 'ws'] })),
}))

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const knowledgeBase = { id: 'knowledge-1', workspaceId: 'workspace-1' }
const principal = createSessionPrincipal()

describe('knowledge application contexts', () => {
  beforeEach(() => {
    resetDbChainMock()
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(
      null
    )
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mocks.getKnowledgeBaseWithCounts.mockResolvedValue({
      ...knowledgeBase,
      docCount: 3,
      tokenCount: 1536,
    })
    workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(workspace)
    workspaceContextMockFns.mockLoadWorkspaceApplicationContext.mockResolvedValue(workspace)
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

  it('conceals a missing or archived knowledge-base reference before loading its owner', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce(null)

    await expect(
      resolveActiveKnowledgeResourceContext({ knowledgeBaseId: 'archived' }, principal)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext).not.toHaveBeenCalled()
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

  it('does not look up a document in a knowledge base outside the asserted workspace', async () => {
    await expect(
      resolveActiveKnowledgeDocumentContext(
        {
          knowledgeBaseId: knowledgeBase.id,
          documentId: 'document-1',
          assertedWorkspaceId: 'other-workspace',
        },
        principal
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getDocument).not.toHaveBeenCalled()
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
    expect(workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext).not.toHaveBeenCalled()
    expect(mocks.createAccessProvider).not.toHaveBeenCalled()
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
        expect(
          permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
        ).toHaveBeenLastCalledWith(organizationId)
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
      expect(
        permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
      ).not.toHaveBeenCalled()
      expect(execute).not.toHaveBeenCalled()
    })
  })
})

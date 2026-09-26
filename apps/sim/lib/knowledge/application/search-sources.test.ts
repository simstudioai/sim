import { knowledgeBase, knowledgeConnector, member, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  memberships: vi.fn(),
  accounts: vi.fn(),
  predicate: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  resolveViewerConnectorMemberships: hoisted.memberships,
}))
vi.mock('@/lib/knowledge/connectors/viewer-source-accounts', () => ({
  resolveViewerSourceAccounts: hoisted.accounts,
}))
vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)
vi.mock('@/lib/knowledge/access/predicate', () => ({
  knowledgeAccessCondition: hoisted.predicate,
  knowledgeMetadataCandidateAccessCondition: hoisted.predicate,
}))
vi.mock('@/connectors/registry', () => {
  const registry = {
    google_drive: { id: 'google_drive', search: true, configFields: [{ id: 'folderId' }] },
    gitlab: { id: 'gitlab', search: true, configFields: [{ id: 'host' }, { id: 'project' }] },
    confluence: {
      id: 'confluence',
      search: true,
      requiresMemberIdentity: true,
      configFields: [{ id: 'domain' }, { id: 'spaceKey' }],
    },
    legacy: { id: 'legacy', search: false, configFields: [{ id: 'project' }] },
    slack: { id: 'slack', search: true, configFields: [{ id: 'channel' }] },
  }
  return {
    CONNECTOR_META_REGISTRY: registry,
    getConnectorMeta: (id: keyof typeof registry) => registry[id],
  }
})

import { searchSourceSummarySchema } from '@/lib/api/contracts/knowledge/connectors'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

const mocks = {
  ...hoisted,
  access: knowledgeAccessScopeMockFns.mockCreateKnowledgeAccessProvider,
}

workspaceAuthzMockFns.mockPermissionSatisfies.mockImplementation(
  (actual: string | null) => actual !== null
)

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
const input = { workspaceId: 'workspace' }
const access = { kind: 'user', userId: principal.userId, tokens: ['u:reader@example.test'] }
const ACL = { type: 'viewer-acl' }
const LAST_SYNC = new Date('2026-09-05T12:00:00.000Z')

function source(id: string, connectorType = 'google_drive', accessMode = 'admin') {
  return {
    id,
    createdAt: '2026-09-05T12:00:00.123456Z',
    knowledgeBaseId: 'search-index',
    connectorType,
    sourceConfig: {
      folderId: 'handbook',
      token: 'secret-fixture',
      adminEmail: 'admin@example.test',
    },
    accessMode,
    status: 'active',
    memberSyncStatus: 'idle',
    lastSyncAt: LAST_SYNC as Date | null,
    hasRetainedSyncError: false,
    hasViewerMemberSyncError: false,
    lastMemberSyncAt: null as Date | null,
    credentialGroupId: 'group-secret',
    credentialGroupOptionId: 'option-secret',
  }
}

function seed(rows: ReturnType<typeof source>[], emailVerified = true) {
  queueTableRows(knowledgeConnector, rows)
  queueTableRows(user, [{ emailVerified }])
}

beforeEach(() => {
  resetDbChainMock()
  knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
    workspaceId: input.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  })
  workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
  knowledgeAvailabilityMockFns.mockResolveKnowledgeAccessAvailability.mockResolvedValue({
    sourceMirrored: true,
    memberScoped: true,
  })
  mocks.memberships.mockResolvedValue(new Map())
  mocks.accounts.mockResolvedValue(new Map())
  mocks.access.mockReturnValue({
    get: async () => access,
    getForConnectors: async () => access,
    getForDocuments: async () => access,
    liveSourceConnectorCondition: async () => null,
  })
  mocks.predicate.mockReturnValue(ACL)
})

describe('Search source summaries', () => {
  it.each(['read', 'write', 'admin'])(
    'allows a current workspace %s without exposing credentials or other members',
    async (role) => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(role)
      seed([source('drive')])
      queueTableRows(knowledgeConnector, [
        { connectorId: 'drive', hasDocuments: true, failedCount: 0, isIndexing: false },
      ])
      const result = await listSearchSources.execute({ principal, input })
      expect(result.sources).toEqual([
        {
          knowledgeBaseId: 'search-index',
          connectorId: 'drive',
          connectorType: 'google_drive',
          sourceDescription: '1 folder selected',
          accessMode: 'admin',
          isGitHubInstallation: false,
          availability: 'available',
          enabled: true,
          isSyncing: false,
          lastSyncAt: LAST_SYNC.toISOString(),
          hasSyncError: false,
          hasViewerDocuments: true,
          viewerFailedDocumentCount: 0,
          viewerEmailVerified: true,
          viewerAccounts: [],
          connectionRequired: false,
          viewerMembership: null,
        },
      ])
      expect(searchSourceSummarySchema.parse(result.sources[0])).toEqual(result.sources[0])
      expect(JSON.stringify(result)).not.toMatch(
        /secret-fixture|admin@example|group-secret|option-secret|sourceConfig/
      )
      expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).toHaveBeenCalledWith(input)
      expect(mocks.access).toHaveBeenCalledWith(principal, {
        workspaceId: 'workspace',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
      })
      expect(mocks.predicate).toHaveBeenCalledWith(access)
    }
  )

  it('surfaces retained partial sync errors without returning the private error message', async () => {
    seed([{ ...source('drive'), hasRetainedSyncError: true }])
    const result = await listSearchSources.execute({ principal, input })
    expect(result.sources[0].hasSyncError).toBe(true)
    expect(result.sources[0]).not.toHaveProperty('lastSyncError')
  })

  it('restricts the source query to this workspace, the Search index, and live configured sources', async () => {
    seed([])
    await expect(listSearchSources.execute({ principal, input })).resolves.toEqual({
      sources: [],
      nextCursor: null,
    })
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: expect.arrayContaining([
        {
          type: 'and',
          conditions: [
            { type: 'eq', left: knowledgeBase.workspaceId, right: 'workspace' },
            { type: 'isNull', column: knowledgeBase.organizationId },
          ],
        },
        { type: 'eq', left: knowledgeBase.isSearchIndex, right: true },
        { type: 'isNull', column: knowledgeBase.deletedAt },
        { type: 'isNull', column: knowledgeConnector.archivedAt },
        { type: 'isNull', column: knowledgeConnector.deletedAt },
        { type: 'inArray', column: knowledgeConnector.accessMode, values: ['admin', 'members'] },
      ]),
    })
    expect(mocks.memberships).not.toHaveBeenCalled()
  })

  it('rejects a former workspace member before querying source data', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(listSearchSources.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.memberships).not.toHaveBeenCalled()
  })

  it.each([
    createPersonalApiKeyPrincipal({ userId: 'reader', keyId: 'key' }),
    createWorkspaceApiKeyPrincipal({ workspaceId: 'workspace', keyId: 'key' }),
    {
      kind: 'credential_group_enrollment',
      workspaceId: 'workspace',
      credentialGroupId: 'group',
      enrollmentId: 'enrollment',
      email: 'reader@example.test',
      invitationTokenHash: 'hash',
    },
  ] as const)('refuses $kind before canonical lookup', async (other) => {
    await expect(listSearchSources.execute({ principal: other, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

describe('organization Search source summaries', () => {
  it.each(['member', 'admin'])(
    'returns only the current %s viewer ACL counts without a workspace membership',
    async (role) => {
      knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
        organizationId: 'org-1',
      })
      queueTableRows(member, [{ role }])
      seed([source('drive')])
      queueTableRows(knowledgeConnector, [])
      queueTableRows(knowledgeConnector, [
        { connectorId: 'drive', hasDocuments: true, failedCount: 0, isIndexing: false },
      ])
      const result = await listSearchSources.execute({
        principal,
        input: { organizationId: 'org-1' },
      })
      expect(result.sources[0]).toMatchObject({
        connectorId: 'drive',
        hasViewerDocuments: true,
        viewerEmailVerified: true,
      })
      expect(mocks.access).toHaveBeenCalledWith(principal, { organizationId: 'org-1' })
      expect(mocks.predicate).toHaveBeenCalledWith(access)
      expect(mocks.memberships).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', userId: 'reader' })
      )
      expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toMatch(
        /secret-fixture|admin@example|group-secret|option-secret/
      )
    }
  )

  it('rejects a removed organization member without exposing configured sources', async () => {
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
      organizationId: 'org-1',
    })
    queueTableRows(member, [])
    await expect(
      listSearchSources.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('Organization not found')
    expect(mocks.memberships).not.toHaveBeenCalled()
    expect(mocks.access).not.toHaveBeenCalled()
  })
})

describe('bounded Search progress', () => {
  it('does not read progress for a former member', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(
      readSearchSourceProgress.execute({ principal, input: { ...input, connectorIds: ['drive'] } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('rejects an oversized progress request before document work', async () => {
    await expect(
      readSearchSourceProgress.execute({
        principal,
        input: { ...input, connectorIds: Array(101).fill('drive') },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.access).not.toHaveBeenCalled()
  })
})

describe('bounded Search source pagination', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => source(`source-${String(index).padStart(3, '0')}`))

  it.each(['filter', 'provider', 'excluded-provider', 'viewer', 'scope'] as const)(
    'rejects a cursor replayed under a different %s before reading sources',
    async (change) => {
      seed(rows(26))
      const first = await listSearchSources.execute({ principal, input })
      resetDbChainMock()
      if (change === 'scope')
        knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
          workspaceId: 'other-workspace',
          workspaceOrganizationId: null,
          allowPersonalApiKeys: true,
        })
      await expect(
        listSearchSources.execute({
          principal: change === 'viewer' ? { ...principal, userId: 'other-reader' } : principal,
          input: {
            ...input,
            cursor: first.nextCursor!,
            ...(change === 'filter' ? { mine: true } : {}),
            ...(change === 'provider' ? { connectorType: 'gmail' } : {}),
            ...(change === 'excluded-provider' ? { excludeConnectorType: 'github' } : {}),
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
})

describe('Search source overview', () => {
  it('rechecks current membership before reading the overview', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(readSearchSourceOverview.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.access).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})

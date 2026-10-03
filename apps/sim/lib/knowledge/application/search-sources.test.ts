import { knowledgeConnector, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
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

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
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

import { listSearchSources } from '@/lib/knowledge/application/search-sources'

workspaceAuthzMockFns.mockPermissionSatisfies.mockImplementation(
  (actual: string | null) => actual !== null
)

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
const input = { workspaceId: 'workspace' }
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

function seed(rows: ReturnType<typeof source>[]) {
  queueTableRows(knowledgeConnector, rows)
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
})

describe('Search source summaries', () => {
  it.each(['read', 'write', 'admin'])(
    'allows a current workspace %s without exposing credentials or other members',
    async (role) => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(role)
      seed([source('drive')])
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
        },
      ])
      expect(JSON.stringify(result)).not.toMatch(
        /secret-fixture|admin@example|group-secret|option-secret|sourceConfig/
      )
      expect(knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext).toHaveBeenCalledWith(input)
    }
  )

  it('rejects a former workspace member before querying source data', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(listSearchSources.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
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
    'returns configured sources to a current organization %s without workspace membership',
    async (role) => {
      knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
        organizationId: 'org-1',
      })
      queueTableRows(member, [{ role }])
      seed([source('drive')])
      const result = await listSearchSources.execute({
        principal,
        input: { organizationId: 'org-1' },
      })
      expect(result.sources[0]).toMatchObject({
        connectorId: 'drive',
      })
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
            ...(change === 'filter' ? { search: 'new' } : {}),
            ...(change === 'provider' ? { connectorType: 'gmail' } : {}),
            ...(change === 'excluded-provider' ? { excludeConnectorType: 'github' } : {}),
          },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
})

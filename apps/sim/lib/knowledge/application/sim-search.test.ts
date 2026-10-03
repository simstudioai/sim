import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeBaseUseCasesMock,
  knowledgeBaseUseCasesMockFns,
} from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)
vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/sim-search/connectors', () => ({
  SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
  canConnectPersonally: (meta: { permissionScopedListing?: unknown }) =>
    Boolean(meta.permissionScopedListing),
}))

vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    gitlab: {
      name: 'GitLab',
      search: true,
      auth: { mode: 'apiKey' },
      mirrorsSourceAcls: true,
      configFields: [],
    },
    google_drive: {
      name: 'Google Drive',
      search: true,
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [],
    },
    confluence: {
      name: 'Confluence',
      search: true,
      auth: { mode: 'oauth', provider: 'confluence' },
      permissionScopedListing: { capFieldIds: [] },
      configFields: [{ id: 'spaceKey', title: 'a space key', required: true }],
    },
    gmail: {
      name: 'Gmail',
      search: true,
      auth: { mode: 'oauth', provider: 'google-email' },
      permissionScopedListing: { capFieldIds: ['maxThreads'] },
      searchDefaultSourceConfig: { dateRange: '6m' },
      configFields: [{ id: 'dateRange', title: 'Date Range', required: false }],
    },
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const mocks = {
  ensureAccounts: credentialGroupsServiceMockFns.mockEnsureWorkspaceAccountsGroup,
  createOrganizationKnowledgeBase: knowledgeServiceMockFns.mockCreateAuthorizedKnowledgeBase,
  createKnowledgeBase: knowledgeBaseUseCasesMockFns.mockCreateKnowledgeBaseExecute,
}

knowledgeEmbeddingsMockFns.mockGetConfiguredKbEmbedding.mockResolvedValue({
  model: 'test-embedding',
  dimensions: 1536,
})

knowledgeAvailabilityMockFns.mockRequireKnowledgeMemberAccessAvailable.mockImplementation(
  async (context: { workspaceId: string }) => {
    if (await knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable(context)) return
    throw new OrchestrationError(
      'validation',
      'Per-member access is not available for this workspace'
    )
  }
)

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}

const principal = createSessionPrincipal()
describe('prepareSearchSource', () => {
  afterAll(resetDbChainMock)

  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue(workspaceContext)
    permissionGroupsResolveMockFns.mockGetUserPermissionConfig.mockResolvedValue(
      DEFAULT_PERMISSION_GROUP_CONFIG
    )
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(true)
    mocks.createKnowledgeBase.mockResolvedValue({ knowledgeBase: { id: 'kb-new' } })
    mocks.ensureAccounts.mockResolvedValue({ id: 'accounts-group' })
  })

  it('requires an administrator before preparing a managed source', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'gitlab' },
      })
    ).rejects.toThrow()
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })

  it('refuses unsupported source capabilities before creating an index', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'confluence' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
  })
})

describe('organization Search setup', () => {
  const owner = { organizationId: 'org-1' }
  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue(owner)
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(true)
    mocks.ensureAccounts.mockResolvedValue({ id: 'org-accounts' })
    mocks.createOrganizationKnowledgeBase.mockResolvedValue({ id: 'org-index' })
  })
  function asRole(role: string) {
    for (let i = 0; i < 4; i++) queueTableRows(member, [{ role }])
  }
  it('refuses organization source setup by a member before provisioning accounts or an index', async () => {
    asRole('member')
    await expect(
      prepareSearchSource.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive', accessMode: 'members' },
      })
    ).rejects.toThrow('administrator')
    expect(mocks.ensureAccounts).not.toHaveBeenCalled()
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
  })
})

describe('Mothership Search setup authorization', () => {
  const delegated = {
    kind: 'organization_delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    organizationId: 'org-1',
    delegationId: 'source-setup',
    audience: 'sim:knowledge',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat' },
  } as const
  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue({
      organizationId: 'org-1',
    })
  })
  it.each(['owner', 'admin', 'member'])(
    'rechecks the real %s before presenting setup',
    async (role) => {
      queueTableRows(member, [{ role }])
      const action = prepareSearchSource.authorize({
        principal: delegated,
        input: { organizationId: 'org-1', connectorType: 'google_drive', accessMode: 'members' },
      })
      if (role === 'member') await expect(action).rejects.toMatchObject({ code: 'forbidden' })
      else await expect(action).resolves.toBeUndefined()
      expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
      expect(mocks.ensureAccounts).not.toHaveBeenCalled()
    }
  )
})

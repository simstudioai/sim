import { knowledgeBase, knowledgeConnector, member } from '@sim/db/schema'
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
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
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

const hoisted = vi.hoisted(() => ({
  createConnector: vi.fn(),
  createApprovedSource: vi.fn(),
  deleteConnector: vi.fn(),
  enroll: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)
vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)

vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)

vi.mock('@/lib/knowledge/application/connectors', () => ({
  createApprovedSearchSource: { execute: hoisted.createApprovedSource },
  createKnowledgeConnector: { execute: hoisted.createConnector },
  deleteKnowledgeConnector: { execute: hoisted.deleteConnector },
}))

vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: { execute: hoisted.enroll },
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/sim-search/connectors', () => ({
  SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
  canConnectPersonally: (meta: { permissionScopedListing?: unknown }) =>
    Boolean(meta.permissionScopedListing),
  withSearchSourceDefaults: (
    meta: { searchDefaultSourceConfig?: Record<string, string> },
    sourceConfig: Record<string, string> = {}
  ) => ({ ...(meta.searchDefaultSourceConfig ?? {}), ...sourceConfig }),
  missingSetupFields: (
    meta: { configFields: Array<{ id: string; title: string; required?: boolean }> },
    sourceConfig: Record<string, unknown>
  ) =>
    meta.configFields.filter(
      (field) => field.required && typeof sourceConfig[field.id] !== 'string'
    ),
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
import {
  configureSimSearchConnector,
  connectSimSearchConnector,
  prepareSearchSource,
} from '@/lib/knowledge/application/sim-search'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const mocks = {
  ...hoisted,
  ensureAccounts: credentialGroupsServiceMockFns.mockEnsureWorkspaceAccountsGroup,
  createOrganizationKnowledgeBase: knowledgeServiceMockFns.mockCreateAuthorizedKnowledgeBase,
  createKnowledgeBase: knowledgeBaseUseCasesMockFns.mockCreateKnowledgeBaseExecute,
  deleteKnowledgeBase: knowledgeBaseUseCasesMockFns.mockDeleteKnowledgeBaseOperationExecute,
  requireApproval: knowledgeSearchIntegrationPolicyMockFns.mockRequireOrganizationSearchApproval,
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
const existingConnector = { knowledgeBaseId: 'kb-search', connectorId: 'connector-drive' }

/** The first lookup runs before the coalesced creation and the second inside it. */
function queueConnectorLookups(...results: Array<typeof existingConnector | null>) {
  for (const result of results) {
    queueTableRows(knowledgeConnector, result ? [result] : [])
  }
}

describe('connectSimSearchConnector', () => {
  afterAll(resetDbChainMock)

  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext.mockResolvedValue(workspaceContext)
    permissionGroupsResolveMockFns.mockGetUserPermissionConfig.mockResolvedValue(
      DEFAULT_PERMISSION_GROUP_CONFIG
    )
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(true)
    mocks.createKnowledgeBase.mockResolvedValue({ knowledgeBase: { id: 'kb-new' } })
    mocks.createConnector.mockResolvedValue({ connector: { id: 'connector-new' } })
    mocks.enroll.mockResolvedValue({ url: 'https://sim.test/enroll/token' })
    mocks.ensureAccounts.mockResolvedValue({ id: 'accounts-group' })
  })

  it('reuses a prepared account only when the source enrollment group and option match', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, [
      { ...existingConnector, credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
    ])
    await expect(
      configureSimSearchConnector.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          connectorType: 'google_drive',
          memberCredentialBinding: {
            credentialGroupId: 'group-1',
            credentialGroupOptionId: 'option-1',
          },
        },
      })
    ).resolves.toEqual(existingConnector)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it.each([
    { credentialGroupId: 'other-group', credentialGroupOptionId: 'option-1' },
    { credentialGroupId: 'group-1', credentialGroupOptionId: 'other-option' },
  ])(
    'refuses an existing source with a mismatched prepared account binding %#',
    async (sourceBinding) => {
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
      queueTableRows(knowledgeConnector, [{ ...existingConnector, ...sourceBinding }])
      await expect(
        configureSimSearchConnector.execute({
          principal,
          input: {
            workspaceId: 'workspace-1',
            connectorType: 'google_drive',
            memberCredentialBinding: {
              credentialGroupId: 'group-1',
              credentialGroupOptionId: 'option-1',
            },
          },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(mocks.enroll).not.toHaveBeenCalled()
      expect(mocks.createConnector).not.toHaveBeenCalled()
    }
  )

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

  it('refuses before creating anything when per-member access is unavailable', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(false)
    queueConnectorLookups(null)

    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('uses the source returned by transaction-level creation reuse without deleting another source', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    mocks.createKnowledgeBase.mockRejectedValueOnce(new Error('Duplicate knowledge base name'))
    mocks.createConnector.mockResolvedValueOnce({
      connector: { id: existingConnector.connectorId },
      reused: true,
    })
    queueTableRows(knowledgeBase, [])
    queueTableRows(knowledgeBase, [{ id: existingConnector.knowledgeBaseId }])
    queueConnectorLookups(null, null)
    const result = await connectSimSearchConnector.execute({
      principal,
      input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
    })
    expect(mocks.deleteConnector).not.toHaveBeenCalled()
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ reuseSearchSource: true }),
      })
    )
    expect(result).toEqual({ ...existingConnector, url: 'https://sim.test/enroll/token' })
  })

  it('requires an explicit source when legacy duplicate settings make selection ambiguous', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, [
      { ...existingConnector, connectorId: 'one', sourceConfig: {} },
      { ...existingConnector, connectorId: 'two', sourceConfig: {} },
    ])
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { workspaceId: 'workspace-1', connectorType: 'google_drive' },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.enroll).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing or outside the canonical index', rows: [], config: undefined },
    {
      name: 'different settings',
      rows: [{ ...existingConnector, sourceConfig: { spaceKey: 'OPS' } }],
      config: { spaceKey: 'ENG' },
    },
  ])('rejects an explicitly selected source that is $name', async ({ rows, config }) => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    queueTableRows(knowledgeConnector, rows)
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          connectorType: 'confluence',
          connectorId: existingConnector.connectorId,
          sourceConfig: config,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.enroll).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
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
    mocks.enroll.mockResolvedValue({ url: 'https://fixture.test/enroll' })
  })
  function asRole(role: string) {
    for (let i = 0; i < 4; i++) queueTableRows(member, [{ role }])
  }
  it('lets an approved member create a personal source without impersonating an admin', async () => {
    asRole('member')
    queueTableRows(knowledgeBase, [])
    mocks.createApprovedSource.mockResolvedValue({ connector: { id: 'approved-source' } })
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).resolves.toMatchObject({ knowledgeBaseId: 'org-index', connectorId: 'approved-source' })
    expect(mocks.requireApproval).toHaveBeenCalledWith('org-1', 'google_drive')
    expect(mocks.createApprovedSource).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: {
          knowledgeBaseId: 'org-index',
          assertedOrganizationId: 'org-1',
          connectorType: 'google_drive',
          sourceConfig: {},
        },
      })
    )
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })
  it('refuses unapproved members before provisioning anything', async () => {
    asRole('member')
    mocks.requireApproval.mockRejectedValueOnce(new Error('Approval required'))
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).rejects.toThrow('Approval required')
    expect(mocks.createOrganizationKnowledgeBase).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
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
  it('refuses a former organization member before looking up any configured source', async () => {
    queueTableRows(member, [])
    await expect(
      connectSimSearchConnector.execute({
        principal,
        input: { ...owner, connectorType: 'google_drive' },
      })
    ).rejects.toThrow('Organization not found')
    expect(mocks.enroll).not.toHaveBeenCalled()
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
      expect(mocks.enroll).not.toHaveBeenCalled()
    }
  )
})

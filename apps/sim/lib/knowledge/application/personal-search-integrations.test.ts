import { user } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import { integrationsAvailabilityMock } from '@sim/testing/mocks/integrations-availability.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  simSearchConnectorsMock,
  simSearchConnectorsMockFns,
} from '@sim/testing/mocks/sim-search-connectors.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  sources: vi.fn(),
  configuredTypes: vi.fn(),
  accounts: vi.fn(),
  completion: vi.fn(),
}))
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/viewer-accounts', () => ({
  listViewerOrganizationAccounts: hoisted.accounts,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/search-connection-completion', () => ({
  readSearchConnectionCompletion: hoisted.completion,
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/application/search-sources', () => ({
  listSearchSources: { execute: hoisted.sources },
}))
vi.mock('@/lib/knowledge/application/search-source-overview', () => ({
  listConfiguredSearchProviderTypes: hoisted.configuredTypes,
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)
vi.mock('@/lib/sim-search/connectors', () => ({
  ...simSearchConnectorsMock,
  SEARCH_CONNECTORS: ['gmail', 'slack', 'notion'].map((type) => ({
    type,
    providerId: type === 'gmail' ? 'google-email' : type,
    meta: { name: type },
    setupFields: [],
  })),
}))

import { personalSearchIntegrationPageSchema } from '@/lib/api/contracts/knowledge/personal-integrations'
import {
  listPersonalSearchIntegrations,
  resolvePersonalSearchConnection,
} from '@/lib/knowledge/application/personal-search-integrations'

const m = {
  ...hoisted,
  group: credentialGroupsServiceMockFns.mockGetOrganizationAccountsGroup,
  scoped: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}

const mockListOrganizationSearchApprovals =
  knowledgeSearchIntegrationPolicyMockFns.mockListOrganizationSearchApprovals
const mockGetConnectorAccessAvailability =
  simSearchConnectorsMockFns.mockGetConnectorAccessAvailability

const principal = createSessionPrincipal({ userId: 'person', sessionId: 'session' })
const input = { organizationId: 'org' }
const target = {
  type: 'link',
  provider: 'google-email',
  connectorType: 'gmail',
  connectorId: 'source',
} as const
const source = {
  connectorType: 'gmail',
  connectorId: 'source',
  knowledgeBaseId: 'kb',
  sourceDescription: '',
  enabled: true,
  availability: 'available',
  viewerEmailVerified: true,
  connectionRequired: true,
  viewerMembership: 'connected',
  viewerAccounts: [{ credentialId: 'mine', displayName: 'My mail', status: 'active' }],
  isSyncing: false,
  hasSyncError: false,
  viewerFailedDocumentCount: 0,
  hasViewerDocuments: false,
}
beforeEach(() => {
  resetDbChainMock()
  resetEnvFlagsMock()
  m.scoped.mockResolvedValue(true)
  m.group.mockResolvedValue({
    id: 'group',
    status: 'active',
    options: [
      { id: 'slack-option', provider: 'slack', status: 'active', configurationStatus: 'ready' },
    ],
  })
  m.accounts.mockResolvedValue([])
  m.completion.mockResolvedValue(null)
  queueTableRows(user, [{ emailVerified: true }])
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockResolvedValue(undefined)
  m.sources.mockResolvedValue({ sources: [source], nextCursor: null })
  m.configuredTypes.mockResolvedValue(['gmail'])
  mockListOrganizationSearchApprovals.mockResolvedValue(
    new Map([
      ['gmail', true],
      ['slack', true],
    ])
  )
  mockGetConnectorAccessAvailability.mockReturnValue({ members: true })
})
describe('personal Search inventory', () => {
  it.each([
    [{}, 'connected', 'not_indexed'],
    [{ isSyncing: true }, 'connected', 'indexing'],
    [{ hasViewerDocuments: true }, 'connected', 'indexed'],
    [{ hasSyncError: true }, 'connected', 'sync_failed'],
    [
      {
        viewerAccounts: [{ credentialId: 'mine', displayName: 'My mail', status: 'needs_reauth' }],
      },
      'reconnect_needed',
      'not_indexed',
    ],
  ])(
    'separates account state from index state %#',
    async (changes, connectionStatus, indexingStatus) => {
      m.sources.mockResolvedValue({ sources: [{ ...source, ...changes }], nextCursor: null })
      const result = await listPersonalSearchIntegrations.execute({ principal, input })
      expect(result.connections[0]).toMatchObject({ connectionStatus, indexingStatus })
      expect(personalSearchIntegrationPageSchema.safeParse(result).success).toBe(true)
      expect(m.sources).toHaveBeenCalledWith({ principal, input })
      expect(m.configuredTypes).toHaveBeenCalledWith({ organizationId: 'org' })
      expect(JSON.stringify(result)).not.toMatch(/accessToken|authorizationUrl|other-person/)
    }
  )
  it('offers approved ready providers with no index, excluding app setup and unapproved providers', async () => {
    m.sources.mockResolvedValue({ sources: [], nextCursor: null })
    m.configuredTypes.mockResolvedValue([])
    const result = await listPersonalSearchIntegrations.execute({ principal, input })
    expect(result.available.map((entry) => entry.target.connectorType)).toEqual(['gmail'])
    expect(result.connections).toEqual([])
  })
  it('omits every connection action when the person has an unverified email', async () => {
    resetDbChainMock()
    queueTableRows(user, [{ emailVerified: false }])
    m.sources.mockResolvedValue({ sources: [], nextCursor: null })
    m.configuredTypes.mockResolvedValue([])
    expect((await listPersonalSearchIntegrations.execute({ principal, input })).available).toEqual(
      []
    )
  })
  it('forwards the bounded cursor and provider filter without exposing other people’s accounts', async () => {
    m.sources.mockResolvedValue({
      sources: [{ ...source, viewerAccounts: [], viewerMembership: 'not_enrolled' }],
      nextCursor: 'next',
    })
    const filtered = { ...input, connectorType: 'gmail', cursor: 'page' }
    const result = await listPersonalSearchIntegrations.execute({ principal, input: filtered })
    expect(result.connections).toEqual([])
    expect(result.nextCursor).toBe('next')
    expect(result.available).toEqual([{ name: 'gmail', description: '', target }])
    expect(m.sources).toHaveBeenCalledWith({ principal, input: filtered })
  })
  it('rechecks authorization before every read and returns nothing after membership is revoked', async () => {
    organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockRejectedValue(
      new Error('Membership revoked')
    )
    await expect(listPersonalSearchIntegrations.execute({ principal, input })).rejects.toThrow(
      'Membership revoked'
    )
    expect(m.sources).not.toHaveBeenCalled()
  })
  it.each([
    { ...target, credentialId: 'another-person' },
    { ...target, connectorId: 'other-source' },
    { ...target, provider: 'notion' },
  ])('rejects a forged or stale reconnect target', async (forged) => {
    m.sources.mockResolvedValue({
      sources: [
        {
          ...source,
          viewerAccounts: [
            { credentialId: 'mine', displayName: 'My mail', status: 'needs_reauth' },
          ],
        },
      ],
      nextCursor: null,
    })
    await expect(
      resolvePersonalSearchConnection.execute({ principal, input: { ...input, target: forged } })
    ).rejects.toThrow('no longer available')
  })
  it('returns the precise owned reconnect target', async () => {
    m.sources.mockResolvedValue({
      sources: [
        {
          ...source,
          viewerAccounts: [
            { credentialId: 'mine', displayName: 'My mail', status: 'needs_reauth' },
          ],
        },
      ],
      nextCursor: null,
    })
    const selected = { ...target, credentialId: 'mine' }
    await expect(
      resolvePersonalSearchConnection.execute({ principal, input: { ...input, target: selected } })
    ).resolves.toEqual({ name: 'gmail', target: selected })
  })
})

describe('live Search connection controls', () => {
  const liveTarget = {
    type: 'link',
    provider: 'slack',
    connectorType: 'slack',
    connectionMode: 'live',
    optionId: 'slack-option',
  } as const
  beforeEach(() => setEnvFlags({ isLiveEnterpriseSearchEnabled: true }))

  it('offers Slack without a knowledge base or indexed connector and round-trips the response', async () => {
    const result = await listPersonalSearchIntegrations.execute({ principal, input })
    expect(result.available).toEqual([{ name: 'slack', description: '', target: liveTarget }])
    expect(result.connections).toEqual([])
    expect(personalSearchIntegrationPageSchema.parse(result)).toEqual(result)
    expect(m.sources).not.toHaveBeenCalled()
    expect(m.configuredTypes).not.toHaveBeenCalled()
    expect(m.accounts).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org', userId: 'person' })
    )
  })

  it('offers Gmail when its Credential Group provider differs from its OAuth provider ID', async () => {
    m.group.mockResolvedValue({
      id: 'group',
      status: 'active',
      options: [
        { id: 'gmail-option', provider: 'gmail', status: 'active', configurationStatus: 'ready' },
      ],
    })
    m.accounts.mockResolvedValue([
      {
        optionId: 'gmail-option',
        credentialId: 'my-gmail',
        displayName: 'me@example.com',
        status: 'active',
      },
    ])

    const result = await listPersonalSearchIntegrations.execute({ principal, input })
    const addTarget = {
      type: 'link',
      provider: 'gmail',
      connectorType: 'gmail',
      connectionMode: 'live',
      optionId: 'gmail-option',
    }
    expect(result.available).toEqual([{ name: 'gmail', description: '', target: addTarget }])
    expect(result.connections[0].accounts).toEqual([
      {
        credentialId: 'my-gmail',
        displayName: 'me@example.com',
        status: 'connected',
        action: { ...addTarget, credentialId: 'my-gmail' },
      },
    ])
  })

  it('keeps adding an account distinct from reconnecting an owned account', async () => {
    m.accounts.mockResolvedValue([
      { optionId: 'slack-option', credentialId: 'mine', displayName: 'My Slack', status: 'active' },
    ])
    const result = await listPersonalSearchIntegrations.execute({ principal, input })
    expect(result.available[0].target).toEqual(liveTarget)
    expect(result.connections[0].accounts[0].action).toEqual({
      ...liveTarget,
      credentialId: 'mine',
    })
    expect(result.connections[0].indexingStatus).toBeUndefined()
    expect(personalSearchIntegrationPageSchema.safeParse(result).success).toBe(true)
  })

  it.each([
    { ...liveTarget, credentialId: 'another-person' },
    { ...liveTarget, optionId: 'another-option' },
    { ...liveTarget, provider: 'gmail' },
    { ...liveTarget, connectionMode: undefined, optionId: undefined },
  ])('rejects a forged or stale live target: %j', async (target) => {
    await expect(
      resolvePersonalSearchConnection.execute({ principal, input: { ...input, target } })
    ).rejects.toThrow('no longer available')
  })

  it.each(['disabled', 'unconfigured', 'unapproved', 'unverified', 'missing'])(
    'withholds connection controls when %s',
    async (state) => {
      if (state === 'disabled')
        m.group.mockResolvedValue({
          id: 'group',
          status: 'disabled',
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              status: 'active',
              configurationStatus: 'ready',
            },
          ],
        })
      if (state === 'unconfigured')
        m.group.mockResolvedValue({
          id: 'group',
          status: 'active',
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              status: 'active',
              configurationStatus: 'missing',
            },
          ],
        })
      if (state === 'unapproved') mockListOrganizationSearchApprovals.mockResolvedValue(new Map())
      if (state === 'missing') m.group.mockResolvedValue(null)
      if (state === 'unverified') {
        resetDbChainMock()
        queueTableRows(user, [{ emailVerified: false }])
      }
      expect(
        (await listPersonalSearchIntegrations.execute({ principal, input })).available
      ).toEqual([])
    }
  )

  it('reads completion only in the current organization and user scope', async () => {
    m.completion.mockResolvedValue('mine')
    const result = await listPersonalSearchIntegrations.execute({
      principal,
      input: { ...input, completionId: 'attempt' },
    })
    expect(result.completedCredentialId).toBe('mine')
    expect(m.completion).toHaveBeenCalledWith({
      organizationId: 'org',
      userId: 'person',
      completionId: 'attempt',
    })
  })

  it('rejects an indexed source target after switching to live search', async () => {
    await expect(
      listPersonalSearchIntegrations.execute({
        principal,
        input: { ...input, connectorId: 'stale-source' },
      })
    ).rejects.toThrow('Refresh your live account connections')
    expect(m.group).not.toHaveBeenCalled()
  })
})

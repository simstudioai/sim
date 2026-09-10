/** @vitest-environment node */
import { user } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  sources: vi.fn(),
  overview: vi.fn(),
  approvals: vi.fn(),
  availability: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: m.authorize,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/application/search-sources', () => ({
  listSearchSources: { execute: m.sources },
}))
vi.mock('@/lib/knowledge/application/search-source-overview', () => ({
  readSearchSourceOverview: { execute: m.overview },
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  listOrganizationSearchApprovals: m.approvals,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  resolveKnowledgeAccessAvailability: async () => ({ memberScoped: true, sourceMirrored: true }),
}))
vi.mock('@/lib/integrations/availability.server', () => ({
  getIntegrationAvailability: () => [],
  isOAuthServiceDeploymentAvailable: () => true,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_CONNECTORS: ['gmail', 'slack', 'notion'].map((type) => ({
    type,
    providerId: type,
    meta: { name: type },
    setupFields: [],
  })),
  getConnectorAccessAvailability: m.availability,
}))

import { personalSearchIntegrationPageSchema } from '@/lib/api/contracts/knowledge/personal-integrations'
import {
  listPersonalSearchIntegrations,
  resolvePersonalSearchConnection,
} from '@/lib/knowledge/application/personal-search-integrations'

const principal = { kind: 'session', userId: 'person', sessionId: 'session' } as const
const input = { organizationId: 'org' }
const target = {
  type: 'link',
  provider: 'gmail',
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
  viewerDocumentCount: 0,
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  queueTableRows(user, [{ emailVerified: true }])
  m.authorize.mockResolvedValue(undefined)
  m.sources.mockResolvedValue({ sources: [source], nextCursor: null })
  m.overview.mockResolvedValue({ providers: [{ connectorType: 'gmail' }] })
  m.approvals.mockResolvedValue(
    new Map([
      ['gmail', true],
      ['slack', true],
    ])
  )
  m.availability.mockReturnValue({ members: true })
})
describe('personal Search inventory', () => {
  it.each([
    [{}, 'connected', 'not_indexed'],
    [{ isSyncing: true }, 'connected', 'indexing'],
    [{ viewerDocumentCount: 3 }, 'connected', 'indexed'],
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
      expect(JSON.stringify(result)).not.toMatch(/accessToken|authorizationUrl|other-person/)
    }
  )
  it('offers approved ready providers with no index, excluding app setup and unapproved providers', async () => {
    m.sources.mockResolvedValue({ sources: [], nextCursor: null })
    m.overview.mockResolvedValue({ providers: [] })
    const result = await listPersonalSearchIntegrations.execute({ principal, input })
    expect(result.available.map((entry) => entry.target.connectorType)).toEqual(['gmail'])
    expect(result.connections).toEqual([])
  })
  it('omits every connection action when the person has an unverified email', async () => {
    resetDbChainMock()
    queueTableRows(user, [{ emailVerified: false }])
    m.sources.mockResolvedValue({ sources: [], nextCursor: null })
    m.overview.mockResolvedValue({ providers: [] })
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
    m.authorize.mockRejectedValue(new Error('Membership revoked'))
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

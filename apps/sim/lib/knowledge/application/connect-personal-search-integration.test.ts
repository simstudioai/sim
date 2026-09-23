/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  resolve: vi.fn(),
  indexed: vi.fn(),
  group: vi.fn(),
  oauth: vi.fn(),
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
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  resolvePersonalSearchConnection: { execute: m.resolve },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  connectSimSearchConnector: { execute: m.indexed },
}))
vi.mock('@/lib/credential-groups/service', () => ({
  getOrganizationAccountsGroup: m.group,
  ensureWorkspaceAccountsGroup: vi.fn(),
  updateCredentialGroup: vi.fn(),
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: async () => true,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: async () => null,
}))
vi.mock('@/lib/credential-groups/self-enrollment-oauth', () => ({
  startViewerCredentialGroupOAuth: m.oauth,
}))

import { connectPersonalSearchIntegrationContract } from '@/lib/api/contracts/knowledge/personal-integrations'
import { connectPersonalSearchIntegration } from '@/lib/knowledge/application/connect-personal-search-integration'

const principal = { kind: 'session', userId: 'person', sessionId: 'session' } as const
const target = {
  type: 'link',
  provider: 'slack',
  connectorType: 'slack',
  connectionMode: 'live',
  optionId: 'slack-option',
} as const
const input = {
  organizationId: 'org',
  target,
  oauthCompletionId: '550e8400-e29b-41d4-a716-446655440000',
}

beforeEach(() => {
  vi.clearAllMocks()
  m.authorize.mockResolvedValue({ organizationId: 'org', userId: 'person', role: 'member' })
  m.resolve.mockResolvedValue({ name: 'Slack', target })
  m.group.mockResolvedValue({
    id: 'group',
    status: 'active',
    options: [{ id: 'slack-option', status: 'active' }],
  })
  m.oauth.mockResolvedValue({
    invitationLink: 'https://sim.test/invitation',
    authorizationUrl: 'https://provider.test/oauth',
  })
})

describe('personal live Search connection', () => {
  it.each([undefined, 'owned-account'])(
    'starts the canonical account option with an exact completion intent: %s',
    async (credentialId) => {
      const selected = credentialId ? { ...target, credentialId } : target
      m.resolve.mockResolvedValue({ target: selected })
      const result = await connectPersonalSearchIntegration.execute({
        principal,
        input: { ...input, target: selected },
      })
      expect(result.url).toBe('https://provider.test/oauth')
      expect(result.connectorId).toBeUndefined()
      expect(
        connectPersonalSearchIntegrationContract.response.schema.safeParse({
          success: true,
          data: result,
        }).success
      ).toBe(true)
      expect(m.oauth).toHaveBeenCalledWith({
        organizationId: 'org',
        userId: 'person',
        credentialGroupId: 'group',
        optionId: 'slack-option',
        completionId: input.oauthCompletionId,
        connectionIntent: credentialId ? { kind: 'reconnect', credentialId } : { kind: 'create' },
      })
      expect(m.indexed).not.toHaveBeenCalled()
      expect(m.authorize).toHaveBeenCalledWith(
        principal,
        expect.objectContaining({
          id: 'organization_accounts.connect',
          capability: 'integrations.manage',
        }),
        expect.objectContaining({ organizationId: 'org' })
      )
    }
  )

  it('refuses a stale or forged target before creating any OAuth attempt', async () => {
    m.resolve.mockRejectedValue(new Error('This connection is no longer available'))
    await expect(connectPersonalSearchIntegration.execute({ principal, input })).rejects.toThrow(
      'no longer available'
    )
    expect(m.oauth).not.toHaveBeenCalled()
    expect(m.indexed).not.toHaveBeenCalled()
  })

  it('rechecks disabled account options after resolving the card', async () => {
    m.group.mockResolvedValue({
      id: 'group',
      status: 'active',
      options: [{ id: 'slack-option', status: 'disabled' }],
    })
    await expect(connectPersonalSearchIntegration.execute({ principal, input })).rejects.toThrow(
      'no longer available'
    )
    expect(m.oauth).not.toHaveBeenCalled()
  })

  it('continues to use indexed enrollment for indexed controls', async () => {
    const indexed = {
      type: 'link',
      provider: 'slack',
      connectorType: 'slack',
      connectorId: 'source',
    } as const
    m.resolve.mockResolvedValue({ target: indexed })
    m.indexed.mockResolvedValue({
      url: 'https://provider.test/oauth',
      connectorId: 'source',
      knowledgeBaseId: 'kb',
    })
    await connectPersonalSearchIntegration.execute({
      principal,
      input: { ...input, target: indexed },
    })
    expect(m.indexed).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({
          connectorId: 'source',
          oauthCompletionId: input.oauthCompletionId,
        }),
      })
    )
    expect(m.oauth).not.toHaveBeenCalled()
  })
})

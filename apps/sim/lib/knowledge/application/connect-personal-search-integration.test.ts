import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { credentialGroupsAvailabilityMock } from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialGroupsServiceMock,
  credentialGroupsServiceMockFns,
} from '@sim/testing/mocks/credential-groups-service.mock'
import { knowledgeContextsMock } from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resolve: vi.fn(),
  indexed: vi.fn(),
  oauth: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  resolvePersonalSearchConnection: { execute: hoisted.resolve },
}))
vi.mock('@/lib/knowledge/application/sim-search', () => ({
  connectSimSearchConnector: { execute: hoisted.indexed },
}))
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/self-enrollment-oauth', () => ({
  startViewerCredentialGroupOAuth: hoisted.oauth,
}))

import { connectPersonalSearchIntegrationContract } from '@/lib/api/contracts/knowledge/personal-integrations'
import { connectPersonalSearchIntegration } from '@/lib/knowledge/application/connect-personal-search-integration'

const m = {
  ...hoisted,
  group: credentialGroupsServiceMockFns.mockGetOrganizationAccountsGroup,
}

credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext.mockResolvedValue(
  null
)

const principal = createSessionPrincipal({ userId: 'person', sessionId: 'session' })
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
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockResolvedValue({
    organizationId: 'org',
    userId: 'person',
    role: 'member',
  })
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
      expect(
        organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation
      ).toHaveBeenCalledWith(
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

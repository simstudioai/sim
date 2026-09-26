import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  mothershipChatStatusMock,
  mothershipChatStatusMockFns,
} from '@sim/testing/mocks/mothership-chat-status.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import {
  authorizeOrganizationChat,
  authorizeOrganizationChatCancellation,
  authorizeOrganizationChatDelegation,
  authorizeOrganizationChatEvents,
  createOrganizationChat,
} from '@/lib/mothership/chat/organization-chats'

const authorize = organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation
const permissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization
const requireSearch = knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable

const publish = mothershipChatStatusMockFns.mockPublishChatStatusChanged

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)

const principal = () =>
  createTrustedOrganizationCopilotPrincipal(
    {
      userId: 'member-1',
      organizationId: 'org-1',
      chatId: 'private-chat',
      delegationId: 'tool-call',
    },
    { audience: 'sim:knowledge', ttlMs: 10000 }
  )

describe('private organization chat delegation', () => {
  beforeEach(() => {
    resetDbChainMock()
    authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role: 'member' })
  })

  it('requires both current membership and the persisted private chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'private-chat' }])
    await expect(
      authorizeOrganizationChatDelegation.execute({ principal: principal() })
    ).resolves.toMatchObject({ userId: 'member-1', organizationId: 'org-1' })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: 'member-1' }),
      expect.objectContaining({ capability: 'copilot.use', delegationAudience: 'sim:knowledge' }),
      { organizationId: 'org-1' }
    )
  })

  it('refuses missing, deleted, cross-organization, or another member’s private chat', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      authorizeOrganizationChatDelegation.execute({ principal: principal() })
    ).rejects.toThrow('Conversation not found')
  })

  it('stops after membership revocation before accessing the conversation', async () => {
    authorize.mockRejectedValueOnce(new OrchestrationError('not_found', 'Organization not found'))
    await expect(
      authorizeOrganizationChatDelegation.execute({ principal: principal() })
    ).rejects.toThrow('Organization not found')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('keeps cancellation member/chat checks while exempting the disabled Copilot capability', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'private-chat' }])
    await authorizeOrganizationChatDelegation.execute({
      principal: { ...principal(), audience: 'sim:copilot-cancel' },
    })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: 'member-1' }),
      expect.objectContaining({
        id: 'organization.chats.cancel',
        minimumRole: 'member',
        capability: 'none',
      }),
      { organizationId: 'org-1' }
    )
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      authorizeOrganizationChatDelegation.execute({
        principal: { ...principal(), audience: 'sim:copilot-cancel' },
      })
    ).rejects.toThrow('Conversation not found')
  })

  it('does not accept an audience outside its registered operations', async () => {
    await expect(
      authorizeOrganizationChatDelegation.execute({
        principal: { ...principal(), audience: 'sim:credentials' },
      })
    ).rejects.toThrow('Invalid conversation delegation')
    expect(authorize).not.toHaveBeenCalled()
  })
})

describe('organization chat events application boundary', () => {
  const principal = createSessionPrincipal({ userId: 'member-1' })
  beforeEach(() => {
    resetDbChainMock()
    authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role: 'member' })
    requireSearch.mockResolvedValue(undefined)
  })

  it('authorizes current membership without requiring the search-only rollout', async () => {
    await authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    expect(authorize).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        id: 'organization.chats.subscribe',
        principalKinds: ['session'],
        minimumRole: 'member',
        capability: 'copilot.use',
      }),
      { organizationId: 'org-1' }
    )
    expect(requireSearch).not.toHaveBeenCalled()
  })

  it('uses the same cancellation policy for authenticated session and delegated callbacks', async () => {
    await authorizeOrganizationChatCancellation.execute({
      principal,
      input: { organizationId: 'org-1' },
    })
    expect(authorize).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        id: 'organization.chats.cancel',
        minimumRole: 'member',
        capability: 'none',
        principalKinds: ['session', 'organization_delegated'],
      }),
      { organizationId: 'org-1' }
    )
    expect(requireSearch).not.toHaveBeenCalled()
  })

  it('does not examine rollout state for a non-member', async () => {
    authorize.mockRejectedValueOnce(new OrchestrationError('not_found', 'Organization not found'))
    await expect(
      authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('Organization not found')
    expect(requireSearch).not.toHaveBeenCalled()
  })

  it('keeps shared chat events available with search disabled and propagates authorization failures', async () => {
    requireSearch.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Search is disabled'))
    await expect(
      authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    ).resolves.toMatchObject({ organizationId: 'org-1', userId: 'member-1' })
    expect(requireSearch).not.toHaveBeenCalled()
    authorize.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('database unavailable')
  })

  it('publishes newly created chats only after persistence and under the canonical owner', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'new-chat' }])
    await createOrganizationChat.execute({ principal, input: { organizationId: 'org-1' } })
    expect(publish).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'member-1', role: 'member' },
      { chatId: 'new-chat', type: 'created' }
    )
    expect(dbChainMockFns.returning.mock.invocationCallOrder[0]).toBeLessThan(
      publish.mock.invocationCallOrder[0]
    )
  })
})

afterAll(resetEnvFlagsMock)
describe('organization Build admission', () => {
  const session = createSessionPrincipal({ userId: 'member-1' })
  beforeEach(() => {
    resetDbChainMock()
    permissionConfig.mockResolvedValue(null)
    setEnvFlags({ isBillingEnabled: true })
  })
  it.each([
    { role: 'member', billing: true, denied: false, allowed: false },
    { role: 'owner', billing: true, denied: false, allowed: true },
    { role: 'admin', billing: true, denied: true, allowed: false },
    { role: 'member', billing: false, denied: false, allowed: true },
    { role: 'member', billing: false, denied: true, allowed: false },
  ])(
    'enforces the same permission on sends and creation: $role/$billing/$denied',
    async ({ role, billing, denied, allowed }) => {
      authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role })
      permissionConfig.mockResolvedValue({ disableWorkspaceCreation: denied })
      setEnvFlags({ isBillingEnabled: billing })
      dbChainMockFns.returning.mockResolvedValue([{ id: 'new-chat' }])
      for (const mode of ['agent', 'plan'] as const) {
        for (const operation of [authorizeOrganizationChat, createOrganizationChat]) {
          const result = operation.execute({
            principal: session,
            input: { organizationId: 'org-1', mode },
          })
          if (allowed) await expect(result).resolves.toBeDefined()
          else await expect(result).rejects.toThrow('Build requires permission')
        }
      }
      if (!allowed) expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(permissionConfig).toHaveBeenCalledWith('org-1')
    }
  )
  it('keeps Search and saved-history reads available without Build permission', async () => {
    authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role: 'member' })
    await authorizeOrganizationChat.execute({
      principal: session,
      input: { organizationId: 'org-1', mode: 'assistant' },
    })
    await authorizeOrganizationChat.execute({
      principal: session,
      input: { organizationId: 'org-1' },
    })
    expect(permissionConfig).not.toHaveBeenCalled()
  })
  it.each(['agent', 'plan'] as const)(
    'rechecks %s permission for a delegated continuation while allowing Search',
    async (mode) => {
      authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role: 'owner' })
      permissionConfig.mockResolvedValue({ disableWorkspaceCreation: true })
      dbChainMockFns.limit.mockResolvedValue([{ id: 'private-chat' }])
      await expect(
        authorizeOrganizationChatDelegation.execute({ principal: principal(), mode })
      ).rejects.toThrow('Build requires permission')
      await expect(
        authorizeOrganizationChatDelegation.execute({ principal: principal(), mode: 'assistant' })
      ).resolves.toMatchObject({ userId: 'member-1' })
    }
  )

  it('checks current membership before the Build permission projection', async () => {
    authorize.mockRejectedValueOnce(new Error('Membership revoked'))
    await expect(
      authorizeOrganizationChat.execute({
        principal: session,
        input: { organizationId: 'org-1', mode: 'agent' },
      })
    ).rejects.toThrow('Membership revoked')
    expect(permissionConfig).not.toHaveBeenCalled()
  })
})

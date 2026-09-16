/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/copilot/auth/application-delegation'
import {
  authorizeOrganizationChatDelegation,
  authorizeOrganizationChatEvents,
  createOrganizationChat,
} from '@/lib/copilot/chat/organization-chats'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { authorize, requireSearch, publish } = vi.hoisted(() => ({
  authorize: vi.fn(),
  requireSearch: vi.fn(),
  publish: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: requireSearch,
}))
vi.mock('@/lib/copilot/chat-status', () => ({ publishChatStatusChanged: publish }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: authorize,
}))

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
    vi.clearAllMocks()
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
  const principal = { kind: 'session', userId: 'member-1', sessionId: 'session-1' } as const
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authorize.mockResolvedValue({ userId: 'member-1', organizationId: 'org-1', role: 'member' })
    requireSearch.mockResolvedValue(undefined)
  })

  it('authorizes current membership before reading the feature rollout', async () => {
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
    expect(requireSearch).toHaveBeenCalledWith('org-1')
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      requireSearch.mock.invocationCallOrder[0]
    )
  })

  it('does not examine rollout state for a non-member', async () => {
    authorize.mockRejectedValueOnce(new OrchestrationError('not_found', 'Organization not found'))
    await expect(
      authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('Organization not found')
    expect(requireSearch).not.toHaveBeenCalled()
  })

  it('propagates rollout revocation and infrastructure failures', async () => {
    requireSearch.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Search is disabled'))
    await expect(
      authorizeOrganizationChatEvents.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toThrow('Search is disabled')
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

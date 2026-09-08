/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/copilot/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/copilot/chat/organization-chats'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }))
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

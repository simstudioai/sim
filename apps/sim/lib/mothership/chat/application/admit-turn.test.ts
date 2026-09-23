/** @vitest-environment node */
import { copilotChats, copilotRuns, member } from '@sim/db/schema'
import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { admitChatTurn } from '@/lib/mothership/chat/application/admit-turn'

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  lease: vi.fn(),
  config: vi.fn(),
  banned: vi.fn(),
  searchAvailable: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.searchAvailable,
}))
afterAll(resetEnvFlagsMock)
vi.mock('@/lib/mothership/chat/messages-store', () => ({ appendCopilotChatMessages: mocks.append }))
vi.mock('@/lib/mothership/request/session/controller-lease', () => ({
  assertChatStreamLease: mocks.lease,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/mothership/chat-status', () => ({ publishChatStatusChanged: vi.fn() }))

const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
const chatId = '11111111-1111-4111-8111-111111111111'
const streamId = '22222222-2222-4222-8222-222222222222'
const chat = {
  mode: 'assistant',
  userId: 'actor',
  organizationId: 'org-1',
  workspaceId: null,
  type: 'mothership',
}
function input(mode: 'assistant' | 'agent' | 'plan' = 'assistant') {
  return {
    chatId,
    runId: 'run-1',
    executionId: 'execution-1',
    requestId: 'request-1',
    message: { id: streamId, content: 'Find the policy', requestMode: mode },
    recovery: {
      kind: 'interactive_stream' as const,
      goRoute: '/api/mothership' as const,
      clientToolPickupExpected: false,
      request: {
        userId: 'actor',
        chatId,
        messageId: streamId,
        organizationId: 'org-1',
        mode,
        message: 'Find the policy',
      },
    },
    lease: { key: 'lease', value: 'controller' },
    sendClaim: { normalizedKey: 'claim', claimToken: 'token' },
    notifyWorkspaceStatus: false,
  }
}

describe('organization turn admission through current private-chat authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.config.mockResolvedValue(null)
    mocks.banned.mockResolvedValue([])
    mocks.searchAvailable.mockResolvedValue(undefined)
    setEnvFlags({ isBillingEnabled: true })
  })
  it('persists the organization owner and accepted message in the existing admission transaction', async () => {
    queueTableRows(copilotChats, [chat])
    queueTableRows(member, [{ role: 'member' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ model: null }])
      .mockResolvedValueOnce([{ id: 'run-1', organizationId: 'org-1', workspaceId: null }])
      .mockResolvedValueOnce([{ key: 'claim' }])
    const admitted = await admitChatTurn.execute({ principal, input: input() })
    expect(admitted.organizationId).toBe('org-1')
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(copilotRuns)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        workspaceId: null,
        userId: 'actor',
        streamId,
      })
    )
    expect(mocks.append).toHaveBeenCalledWith(
      chatId,
      [
        expect.objectContaining({
          id: streamId,
          content: 'Find the policy',
          requestMode: 'assistant',
        }),
      ],
      expect.objectContaining({ streamId }),
      expect.anything()
    )
  })
  it.each(['agent', 'assistant', 'plan'] as const)(
    'switches the same chat to %s atomically with turn admission',
    async (mode) => {
      queueTableRows(copilotChats, [{ ...chat, mode: mode === 'agent' ? 'assistant' : 'agent' }])
      queueTableRows(member, [{ role: 'owner' }])
      if (mode !== 'assistant') queueTableRows(member, [{ role: 'owner' }])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ model: null }])
        .mockResolvedValueOnce([{ id: 'run-1' }])
        .mockResolvedValueOnce([{ key: 'claim' }])
      await admitChatTurn.execute({ principal, input: input(mode) })
      const update = dbChainMockFns.set.mock.calls[0][0]
      expect(Object.keys(update).sort()).toEqual(['config', 'conversationId', 'updatedAt'])
      expect(update.config.toSQL().sql).toContain("jsonb_build_object('conversationMode'")
      expect(update.config.toSQL().params).toContain(mode)
      expect(mocks.append).toHaveBeenCalledWith(
        chatId,
        [expect.objectContaining({ requestMode: mode })],
        expect.anything(),
        expect.anything()
      )
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          requestContext: expect.objectContaining({
            recovery: expect.objectContaining({
              request: expect.objectContaining({ mode, chatId }),
            }),
          }),
        })
      )
    }
  )
  it.each(['agent', 'plan'] as const)(
    'denies switching to %s without current workspace-create permission before any mutation',
    async (mode) => {
      queueTableRows(copilotChats, [chat])
      queueTableRows(member, [{ role: 'member' }])
      queueTableRows(member, [{ role: 'member' }])
      await expect(admitChatTurn.execute({ principal, input: input(mode) })).rejects.toThrow(
        'Build requires permission'
      )
      expect(dbChainMockFns.set).not.toHaveBeenCalled()
      expect(mocks.append).not.toHaveBeenCalled()
    }
  )
  it('denies switching to Search after its availability is revoked', async () => {
    queueTableRows(copilotChats, [{ ...chat, mode: 'agent' }])
    queueTableRows(member, [{ role: 'owner' }])
    mocks.searchAvailable.mockRejectedValueOnce(new Error('Search disabled'))
    await expect(admitChatTurn.execute({ principal, input: input() })).rejects.toThrow(
      'Search disabled'
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
  it('does not rewrite mode if the stream lease is lost', async () => {
    queueTableRows(copilotChats, [{ ...chat, mode: 'agent' }])
    queueTableRows(member, [{ role: 'owner' }])
    mocks.lease.mockRejectedValueOnce(new Error('Lease lost'))
    await expect(admitChatTurn.execute({ principal, input: input() })).rejects.toThrow('Lease lost')
    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })
  it.each([
    { ...chat, userId: 'other' },
    { ...chat, workspaceId: 'workspace' },
    { ...chat, organizationId: null },
    { ...chat, type: 'copilot' },
  ])('rejects invalid private-chat ownership before persistence', async (row) => {
    queueTableRows(copilotChats, [row])
    await expect(admitChatTurn.execute({ principal, input: input() })).rejects.toThrow(
      'Chat not found'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.append).not.toHaveBeenCalled()
  })
  it('rejects removed membership before admission or message persistence', async () => {
    queueTableRows(copilotChats, [chat])
    await expect(admitChatTurn.execute({ principal, input: input() })).rejects.toThrow(
      'Organization not found'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.lease).not.toHaveBeenCalled()
  })
  it('rejects a request owner different from its canonical chat', async () => {
    queueTableRows(copilotChats, [chat])
    queueTableRows(member, [{ role: 'member' }])
    const request = input()
    request.recovery.request.organizationId = 'org-2'
    await expect(admitChatTurn.execute({ principal, input: request })).rejects.toThrow(
      'Turn identity'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

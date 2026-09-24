/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTool: vi.fn(),
  getRun: vi.fn(),
  ownedChat: vi.fn(),
  permission: vi.fn(),
  available: vi.fn(),
  claim: vi.fn(),
  organization: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getAsyncToolCall: mocks.getTool,
  getRunSegment: mocks.getRun,
}))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mocks.ownedChat,
}))
vi.mock('@/lib/computer-use/availability.server', () => ({
  isComputerUseAvailable: mocks.available,
}))
vi.mock('@/lib/computer-use/repository', () => ({ claimComputerUseTool: mocks.claim }))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.organization,
}))

import { authorizeComputerUse } from '@/lib/computer-use/application/authorize'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const input = { toolCallId: 'call-1' }
const run = {
  id: 'run-1',
  userId: 'user-1',
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  organizationId: null,
  status: 'active',
  toolAdmissionClosedAt: null,
}
const context = {
  chatId: 'chat-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'user-1',
  mode: 'agent',
}

describe('native computer authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTool.mockResolvedValue({ toolName: 'computer', status: 'pending', runId: 'run-1' })
    mocks.getRun.mockResolvedValue(run)
    mocks.ownedChat.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('read')
    mocks.available.mockResolvedValue(true)
    mocks.claim.mockResolvedValue({ args: { action: 'list_apps' } })
  })
  it('returns canonical arguments only after current chat access and an atomic claim', async () => {
    await expect(authorizeComputerUse.execute({ principal, input })).resolves.toEqual({
      toolName: 'computer',
      args: { action: 'list_apps' },
      chatId: 'chat-1',
    })
    expect(mocks.claim).toHaveBeenCalledWith({
      ...input,
      userId: 'user-1',
      runId: 'run-1',
      chatId: 'chat-1',
    })
  })
  it('rejects non-session principals before protected loading', async () => {
    await expect(
      authorizeComputerUse.execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.getTool).not.toHaveBeenCalled()
  })
  it('rejects disabled rollout without claiming an action', async () => {
    mocks.available.mockResolvedValue(false)
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow('unavailable')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('rechecks current workspace membership', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow()
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it.each([
    { userId: 'another-user' },
    { status: 'cancelled' },
    { toolAdmissionClosedAt: new Date() },
  ])('rejects a foreign or stopped run %j', async (change) => {
    mocks.getRun.mockResolvedValue({ ...run, ...change })
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow('not found')
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('rejects canonical chat scope mismatch', async () => {
    mocks.ownedChat.mockResolvedValue({ ...context, workspaceId: 'another-workspace' })
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow(
      'does not belong'
    )
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('rejects a replay or Stop that wins the final claim race', async () => {
    mocks.claim.mockResolvedValue(null)
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow(
      'may already have started'
    )
  })
  it('uses the organization policy for an organization-owned private chat', async () => {
    mocks.getRun.mockResolvedValue({ ...run, workspaceId: null, organizationId: 'org-1' })
    mocks.ownedChat.mockResolvedValue({
      chatId: 'chat-1',
      userId: 'user-1',
      organizationId: 'org-1',
      mode: 'agent',
    })
    await authorizeComputerUse.execute({ principal, input })
    expect(mocks.organization).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        id: 'desktop.computer.execute',
        minimumRole: 'member',
        principalKinds: ['session'],
      }),
      { organizationId: 'org-1' }
    )
  })
  it('propagates infrastructure failures without disguising them as access refusals', async () => {
    mocks.getTool.mockRejectedValue(new Error('database unavailable'))
    await expect(authorizeComputerUse.execute({ principal, input })).rejects.toThrow(
      'database unavailable'
    )
    expect(mocks.claim).not.toHaveBeenCalled()
  })
})

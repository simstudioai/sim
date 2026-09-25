import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
} from '@/lib/mothership/request/application/read-control'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  stopped: vi.fn(),
  config: vi.fn(),
  banned: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: mocks.run,
  isRunStopRequested: mocks.stopped,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))

const input = { chatId: 'chat-1', streamId: 'stream-1' }
function principal() {
  return createTrustedOrganizationCopilotPrincipal(
    { userId: 'actor', organizationId: 'org-1', chatId: 'chat-1', delegationId: 'control-1' },
    { audience: RUN_CONTROL_AUDIENCE, ttlMs: 60_000 }
  )
}
function queueChat() {
  queueTableRows(copilotChats, [
    { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership' },
  ])
  queueTableRows(member, [{ role: 'member' }])
}
describe('organization run-control authorization', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.banned.mockResolvedValue([])
    mocks.config.mockResolvedValue(null)
    mocks.run.mockResolvedValue({
      chatId: 'chat-1',
      userId: 'actor',
      organizationId: 'org-1',
      workspaceId: null,
    })
    mocks.stopped.mockResolvedValue(true)
  })
  it('rechecks the private owner and current membership before reading durable Stop', async () => {
    queueChat()
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: true,
    })
    expect(mocks.stopped).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        organizationId: 'org-1',
        chatId: 'chat-1',
        streamId: 'stream-1',
      })
    )
  })
  it.each(['user', 'organization', 'chat', 'expired'] as const)(
    'rejects altered %s delegation',
    async (field) => {
      queueChat()
      const trusted = principal()
      const caller = {
        ...trusted,
        ...(field === 'user' ? { subjectUserId: 'other' } : {}),
        ...(field === 'organization' ? { organizationId: 'other' } : {}),
        ...(field === 'chat' ? { resourceScope: { chatId: 'other' } } : {}),
        ...(field === 'expired' ? { expiresAt: new Date(0) } : {}),
      }
      await expect(readRunControl.execute({ principal: caller, input })).rejects.toThrow()
      expect(mocks.stopped).not.toHaveBeenCalled()
    }
  )
  it('rejects removed organization membership and a run owned by another organization', async () => {
    queueTableRows(copilotChats, [
      { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership' },
    ])
    await expect(readRunControl.execute({ principal: principal(), input })).rejects.toThrow(
      'Organization not found'
    )
    expect(mocks.stopped).not.toHaveBeenCalled()
    resetDbChainMock()
    queueChat()
    mocks.run.mockResolvedValue({ chatId: 'chat-1', organizationId: 'org-2', workspaceId: null })
    await expect(readRunControl.execute({ principal: principal(), input })).rejects.toThrow(
      'Stream not found'
    )
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
})

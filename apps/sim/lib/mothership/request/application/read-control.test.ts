import { copilotChats, member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { authBanMock, authBanMockFns } from '@sim/testing/mocks/auth-ban.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
} from '@/lib/mothership/request/application/read-control'

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/auth/ban', () => authBanMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

const mocks = {
  run: mothershipAsyncRunsMockFns.mockGetLatestRunForStream,
  stopped: mothershipAsyncRunsMockFns.mockIsRunStopRequested,
  banned: authBanMockFns.mockGetActivelyBannedUserIds,
}

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
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue(
      null
    )
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
  it.each(['chat', 'expired'] as const)('rejects altered %s delegation', async (field) => {
    queueChat()
    const trusted = principal()
    const caller = {
      ...trusted,
      ...(field === 'chat' ? { resourceScope: { chatId: 'other' } } : {}),
      ...(field === 'expired' ? { expiresAt: new Date(0) } : {}),
    }
    await expect(readRunControl.execute({ principal: caller, input })).rejects.toThrow()
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('answers Stop without reading the owner state for a user the chat does not belong to', async () => {
    queueChat()
    const caller = { ...principal(), subjectUserId: 'other' }
    expect(await readRunControl.execute({ principal: caller, input })).toEqual({ stopped: true })
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('rejects a delegation for another organization instead of answering Stop', async () => {
    queueChat()
    const caller = { ...principal(), organizationId: 'other' }
    await expect(readRunControl.execute({ principal: caller, input })).rejects.toThrow(
      'Organization delegation is no longer valid'
    )
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('rejects a delegation that expires while the request reads the chat instead of answering Stop', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      queueChat()
      const caller = principal()
      mocks.banned.mockImplementation(async () => {
        vi.setSystemTime(caller.expiresAt.getTime() + 1)
        return []
      })
      await expect(readRunControl.execute({ principal: caller, input })).rejects.toThrow(
        'Organization delegation is no longer valid'
      )
      expect(mocks.stopped).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('lets a run continue when the member’s group withholds Copilot', async () => {
    queueChat()
    permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization.mockResolvedValue({
      hideCopilot: true,
    })
    mocks.stopped.mockResolvedValue(false)
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: false,
    })
  })
  it('answers Stop once organization membership ends or the run belongs to another organization', async () => {
    queueTableRows(copilotChats, [
      { userId: 'actor', organizationId: 'org-1', workspaceId: null, type: 'mothership' },
    ])
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: true,
    })
    expect(mocks.stopped).not.toHaveBeenCalled()
    resetDbChainMock()
    queueChat()
    mocks.run.mockResolvedValue({ chatId: 'chat-1', organizationId: 'org-2', workspaceId: null })
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: true,
    })
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('answers Stop for a suspended owner', async () => {
    queueChat()
    mocks.banned.mockResolvedValue(['actor'])
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: true,
    })
    expect(mocks.stopped).not.toHaveBeenCalled()
  })
  it('lets a live run continue', async () => {
    queueChat()
    mocks.stopped.mockResolvedValue(false)
    expect(await readRunControl.execute({ principal: principal(), input })).toEqual({
      stopped: false,
    })
  })
})

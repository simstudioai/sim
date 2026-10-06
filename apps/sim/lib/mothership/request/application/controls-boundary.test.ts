import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { authBanMock } from '@sim/testing/mocks/auth-ban.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  signal: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: hoisted.signal,
}))
vi.mock('@/lib/mothership/request/session', () => ({
  abortActiveStream: vi.fn(),
  waitForPendingChatStream: vi.fn(async () => true),
  releasePendingChatStream: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/auth/ban', () => authBanMock)

import { abortRun } from '@/lib/mothership/request/application/controls'

const mocks = {
  ...hoisted,
  latest: mothershipAsyncRunsMockFns.mockGetLatestRunForStream,
  stop: mothershipAsyncRunsMockFns.mockRequestRunStop,
  permissions: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
}

beforeEach(() => {
  resetDbChainMock()
  mothershipAsyncRunsMockFns.mockAreStreamToolExecutionsSettled.mockResolvedValue(true)
  mocks.permissions
    .mockReset()
    .mockResolvedValue({ hideCopilot: true, disableWorkspaceCreation: true })
  mocks.stop.mockReset().mockResolvedValue(null)
  mocks.signal.mockReset().mockResolvedValue({ settled: true })
  mocks.latest.mockResolvedValue({
    chatId: 'chat',
    workspaceId: null,
    organizationId: 'organization',
  })
})
describe('abort authorization before service signaling', () => {
  const principal = createSessionPrincipal({ userId: 'actor', sessionId: 'session' })
  const input = { streamId: 'stream', chatId: 'chat' }
  const ownedChat = {
    userId: 'actor',
    workspaceId: null,
    organizationId: 'organization',
    type: 'mothership',
  }

  it('persists and forwards Stop for a current member after chat and Build capabilities are revoked', async () => {
    queueTableRows(schemaMock.copilotChats, [ownedChat])
    queueTableRows(schemaMock.copilotChats, [ownedChat])
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    mocks.stop.mockResolvedValue({
      chatId: 'chat',
      workspaceId: null,
      organizationId: 'organization',
    })

    await expect(abortRun.execute({ principal, input })).resolves.toEqual({
      aborted: true,
      settled: true,
    })

    expect(mocks.stop).toHaveBeenCalledWith({
      streamId: 'stream',
      chatId: 'chat',
      userId: 'actor',
      organizationId: 'organization',
      workspaceId: undefined,
    })
    expect(mocks.signal).toHaveBeenCalledWith({
      streamId: 'stream',
      chatId: 'chat',
      userId: 'actor',
      timeoutMs: 6000,
    })
    expect(mocks.permissions).not.toHaveBeenCalled()
  })

  it('rejects a removed member before persisting or forwarding Stop', async () => {
    queueTableRows(schemaMock.copilotChats, [ownedChat])
    queueTableRows(schemaMock.member, [])
    await expect(abortRun.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('propagates a live membership lookup failure before persisting or forwarding Stop', async () => {
    const error = new Error('membership database unavailable')
    dbChainMockFns.limit.mockResolvedValueOnce([ownedChat]).mockRejectedValueOnce(error)
    await expect(abortRun.execute({ principal, input })).rejects.toBe(error)
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('rejects another user’s canonical chat before persisting or forwarding Stop', async () => {
    queueTableRows(schemaMock.copilotChats, [
      { userId: 'other', workspaceId: null, organizationId: 'organization', type: 'mothership' },
    ])
    await expect(
      abortRun.execute({
        principal: createSessionPrincipal({ userId: 'actor', sessionId: 'session' }),
        input: { streamId: 'stream', chatId: 'chat' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.latest).toHaveBeenCalledWith('stream', 'actor')
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
  it('rejects a foreign asserted chat without loading or signaling that run', async () => {
    await expect(
      abortRun.execute({
        principal: createSessionPrincipal({ userId: 'actor', sessionId: 'session' }),
        input: { streamId: 'stream', chatId: 'foreign' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
  it('rejects an organization assertion that differs from the actor-owned chat', async () => {
    queueTableRows(schemaMock.copilotChats, [
      { userId: 'actor', workspaceId: null, organizationId: 'organization', type: 'mothership' },
    ])
    await expect(
      abortRun.execute({
        principal: createSessionPrincipal({ userId: 'actor', sessionId: 'session' }),
        input: { streamId: 'stream', chatId: 'chat', organizationId: 'foreign' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
})

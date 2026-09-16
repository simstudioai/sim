/** @vitest-environment node */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ latest: vi.fn(), stop: vi.fn(), signal: vi.fn() }))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getLatestRunForStream: mocks.latest,
  requestRunStop: mocks.stop,
  areStreamToolExecutionsSettled: vi.fn(),
  getUnsettledClientWorkflowExecutions: vi.fn(),
  getUnsettledStreamSandboxProcesses: vi.fn(),
}))
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mocks.signal,
}))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: async () => [] }))

import { abortRun } from '@/lib/mothership/request/application/controls'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.latest.mockResolvedValue({
    chatId: 'chat',
    workspaceId: null,
    organizationId: 'organization',
  })
})
describe('abort authorization before service signaling', () => {
  it('rejects another user’s canonical chat before persisting or forwarding Stop', async () => {
    queueTableRows(schemaMock.copilotChats, [
      { userId: 'other', workspaceId: null, organizationId: 'organization', type: 'mothership' },
    ])
    await expect(
      abortRun.execute({
        principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
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
        principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
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
        principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
        input: { streamId: 'stream', chatId: 'chat', organizationId: 'foreign' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })
})

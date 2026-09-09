/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  persist: vi.fn(),
  dispatch: vi.fn(),
  assistant: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  requireSlackInstallationPrincipal: vi.fn(),
  authorizeSlackSearchInstallation: mocks.authorize,
}))
vi.mock('@/lib/knowledge/application/slack-search/assistant', () => ({
  runSlackSearchAssistant: mocks.assistant,
}))
vi.mock('@/lib/knowledge/application/slack-search/turns', () => ({
  persistSlackSearchTurn: mocks.persist,
}))
vi.mock('@/lib/knowledge/application/slack-search/outbox', () => ({
  dispatchSlackSearchTurn: mocks.dispatch,
}))

import { receiveSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const
const message = {
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  channelId: 'D1',
  userId: 'U1',
  messageTs: '1800000000.000001',
  query: 'release notes',
  queryTooLong: false,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({
    installation: { id: 'i1', revision: 'r1', botUserId: 'UBOT' },
  })
  mocks.persist.mockResolvedValue('turn1')
})
describe('Slack Search intake', () => {
  it('accepts channel mentions and strips only this bot’s mention', async () => {
    const input = {
      ...message,
      channelId: 'C1',
      query: '<@UBOT> ask <@UOTHER>',
      origin: { channelId: 'C1', threadTs: message.messageTs, messageTs: message.messageTs },
    }
    await receiveSlackSearchMessage.execute({ principal, input })
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ query: 'ask <@UOTHER>' }) })
    )
  })
  it('accepts new DMs and contextual follow-ups without per-app feature settings', async () => {
    await receiveSlackSearchMessage.execute({ principal, input: message })
    await receiveSlackSearchMessage.execute({
      principal,
      input: { ...message, threadTs: '1000.000001' },
    })
    expect(mocks.persist).toHaveBeenCalledTimes(2)
  })
  it('commits the durable turn before dispatching its outbox entry', async () => {
    await receiveSlackSearchMessage.execute({ principal, input: message })
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 'i1', credentialId: 'c1', revision: 'r1', message })
    )
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatch.mock.invocationCallOrder[0]
    )
    expect(mocks.dispatch).toHaveBeenCalledWith('turn1')
  })
  it('rejects a different authenticated app before persistence', async () => {
    await expect(
      receiveSlackSearchMessage.execute({ principal, input: { ...message, appId: 'A2' } })
    ).rejects.toThrow('authenticated context')
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('ignores disabled installations and bot messages', async () => {
    mocks.authorize.mockResolvedValueOnce(null)
    await receiveSlackSearchMessage.execute({ principal, input: message })
    await receiveSlackSearchMessage.execute({ principal, input: { ...message, userId: 'UBOT' } })
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('does not dispatch a turn that failed to commit', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(receiveSlackSearchMessage.execute({ principal, input: message })).rejects.toThrow(
      'database unavailable'
    )
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})

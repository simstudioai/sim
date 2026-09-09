/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  persist: vi.fn(),
  dispatch: vi.fn(),
  assistant: vi.fn(),
  route: vi.fn(),
  lease: vi.fn(),
  post: vi.fn(),
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
  requireSlackSearchTurnLease: mocks.lease,
}))
vi.mock('@/lib/knowledge/application/slack-search/mention', () => ({
  routeSlackSearchMentionToDm: mocks.route,
}))
vi.mock('@/lib/internal/slack/client', () => ({ postSlackMessage: mocks.post }))
vi.mock('@/lib/knowledge/application/slack-search/outbox', () => ({
  dispatchSlackSearchTurn: mocks.dispatch,
}))

import {
  receiveSlackSearchMessage,
  respondToSlackSearchMessage,
} from '@/lib/knowledge/application/slack-search/process-message'
import { SLACK_SEARCH_QUERY_TOO_LONG } from '@/lib/slack-search/constants'
import type { SlackSearchJob } from '@/lib/slack-search/types'

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
    secret: { botToken: 'test-token' },
  })
  mocks.persist.mockResolvedValue('turn1')
  mocks.route.mockImplementation(async (_principal, { job }) => job)
  mocks.post.mockResolvedValue({ status: 200, data: { ok: true } })
})

describe('Slack Search question validation', () => {
  function respond(overrides: Partial<SlackSearchJob['message']> = {}) {
    return respondToSlackSearchMessage.execute({
      principal,
      input: {
        job: {
          installationId: 'i1',
          revision: 'r1',
          credentialId: 'c1',
          credentialVersion: 'v1',
          receivedAt: principal.receivedAt.getTime(),
          message: { ...message, query: '', queryTooLong: true, ...overrides },
        },
        turnId: 'turn1',
        leaseId: 'lease1',
        controller: new AbortController(),
      },
    })
  }

  it.each([undefined, '1700000000.000001'])(
    'sends a length notice in the original DM thread without running the Assistant: %s',
    async (threadTs) => {
      await respond({ threadTs })
      expect(mocks.lease).toHaveBeenCalledWith('turn1', 'lease1')
      expect(mocks.post).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          channel: 'D1',
          thread_ts: threadTs ?? message.messageTs,
          text: SLACK_SEARCH_QUERY_TOO_LONG,
        }),
        expect.any(AbortSignal)
      )
      expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.post.mock.invocationCallOrder[0]
      )
      expect(mocks.assistant).not.toHaveBeenCalled()
    }
  )
  it('routes an oversized channel mention privately and does not duplicate its root notice', async () => {
    mocks.route.mockImplementationOnce(async (_principal, { job }) => ({
      ...job,
      message: { ...job.message, channelId: 'D1', threadTs: '1700000000.000001' },
    }))
    await respond({ channelId: 'C1' })
    expect(mocks.route).toHaveBeenCalledOnce()
    expect(mocks.post).not.toHaveBeenCalled()
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
  it('does not deliver after the installation is disabled', async () => {
    mocks.authorize.mockResolvedValueOnce(null)
    await expect(respond()).rejects.toThrow('binding changed')
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('does not deliver after losing the durable turn lease', async () => {
    mocks.lease.mockRejectedValueOnce(new Error('lease lost'))
    await expect(respond()).rejects.toThrow('lease lost')
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('propagates an unsuccessful notice delivery without executing the Assistant', async () => {
    mocks.post.mockResolvedValueOnce({ status: 200, data: { ok: false } })
    await expect(respond()).rejects.toThrow('question length notice')
    expect(mocks.post).toHaveBeenCalledOnce()
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous notice delivery', async () => {
    mocks.post.mockRejectedValueOnce(new Error('response lost'))
    await expect(respond()).rejects.toThrow('response lost')
    expect(mocks.post).toHaveBeenCalledOnce()
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
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

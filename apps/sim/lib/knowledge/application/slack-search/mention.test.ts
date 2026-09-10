/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), openDm: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  authorizeSlackSearchInstallation: mocks.authorize,
}))
vi.mock('@/lib/internal/slack/client', () => ({
  openSlackDm: mocks.openDm,
  postSlackMessage: mocks.post,
  slackString: (value: Record<string, unknown>, key: string) =>
    typeof value[key] === 'string' ? value[key] : undefined,
}))

import { routeSlackSearchMentionToDm } from '@/lib/knowledge/application/slack-search/mention'
import { SLACK_SEARCH_QUERY_TOO_LONG } from '@/lib/slack-search/constants'
import { slackSearchJobSchema } from '@/lib/slack-search/types'

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.authorize.mockResolvedValue({ secret: { botToken: 'test-token' } })
  mocks.openDm.mockResolvedValue('D1')
  mocks.post.mockResolvedValue({
    status: 200,
    data: { ok: true, channel: 'D1', ts: '1800000000.2' },
  })
})

describe('private Slack mention roots', () => {
  it.each([false, true])(
    'creates a nonempty private root for queryTooLong=%s',
    async (queryTooLong) => {
      const job = slackSearchJobSchema.parse({
        installationId: 'i1',
        revision: 'r1',
        credentialId: 'c1',
        credentialVersion: 'v1',
        receivedAt: principal.receivedAt.getTime(),
        message: {
          appId: 'A1',
          teamId: 'T1',
          eventId: 'Ev1',
          channelId: 'C1',
          userId: 'U1',
          messageTs: '1800000000.1',
          origin: { channelId: 'C1', threadTs: '1800000000.1', messageTs: '1800000000.1' },
          query: queryTooLong ? '' : 'Find the release notes',
          queryTooLong,
        },
      })
      queueTableRows(schemaMock.slackSearchInstallation, [
        { enabled: true, revision: 'r1', credentialVersion: 'v1' },
      ])
      queueTableRows(schemaMock.slackSearchTurn, [
        {
          status: 'running',
          leaseId: 'lease1',
          leaseExpiresAt: new Date(Date.now() + 60_000),
          payload: job,
        },
      ])
      const routed = await routeSlackSearchMentionToDm(principal, {
        job,
        turnId: 'turn1',
        leaseId: 'lease1',
        signal: new AbortController().signal,
      })
      expect(mocks.post).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          channel: 'D1',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'plain_text',
                text: queryTooLong ? SLACK_SEARCH_QUERY_TOO_LONG : job.message.query,
              },
            },
          ],
        }),
        expect.any(AbortSignal)
      )
      expect(routed.message).toMatchObject({ channelId: 'D1', threadTs: '1800000000.2' })
      expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ payload: routed }))
    }
  )
})

it('creates a real DM root for a slash command and never uses its trigger ID as a timestamp', async () => {
  const job = slackSearchJobSchema.parse({
    installationId: 'i1',
    revision: 'r1',
    credentialId: 'c1',
    credentialVersion: 'v1',
    receivedAt: principal.receivedAt.getTime(),
    message: {
      appId: 'A1',
      teamId: 'T1',
      eventId: 'Ev1',
      channelId: 'C1',
      userId: 'U1',
      messageTs: null,
      command: '/sim-search',
      query: 'Find release notes',
      queryTooLong: false,
    },
  })
  queueTableRows(schemaMock.slackSearchInstallation, [
    { enabled: true, revision: 'r1', credentialVersion: 'v1' },
  ])
  queueTableRows(schemaMock.slackSearchTurn, [
    {
      status: 'running',
      leaseId: 'lease1',
      leaseExpiresAt: new Date(Date.now() + 60000),
      payload: job,
    },
  ])
  const routed = await routeSlackSearchMentionToDm(principal, {
    job,
    turnId: 'turn1',
    leaseId: 'lease1',
    signal: new AbortController().signal,
  })
  expect(routed.message).toMatchObject({
    channelId: 'D1',
    messageTs: '1800000000.2',
    threadTs: '1800000000.2',
  })
  expect(mocks.post).toHaveBeenCalledOnce()
  expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ payload: routed }))
})

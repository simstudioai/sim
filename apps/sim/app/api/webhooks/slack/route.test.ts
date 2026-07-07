/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseWebhookBody,
  mockFindWebhooksByRoutingKey,
  mockCheckWebhookPreprocessing,
  mockQueueWebhookExecution,
  mockBlockExistsInDeployment,
} = vi.hoisted(() => ({
  mockParseWebhookBody: vi.fn(),
  mockFindWebhooksByRoutingKey: vi.fn(),
  mockCheckWebhookPreprocessing: vi.fn(),
  mockQueueWebhookExecution: vi.fn(),
  mockBlockExistsInDeployment: vi.fn(),
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: () => ({ release: vi.fn() }),
  admissionRejectedResponse: () => new Response(null, { status: 503 }),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { SLACK_SIGNING_SECRET: 'test-secret' },
}))

vi.mock('@/lib/webhooks/processor', () => ({
  parseWebhookBody: mockParseWebhookBody,
  findWebhooksByRoutingKey: mockFindWebhooksByRoutingKey,
  checkWebhookPreprocessing: mockCheckWebhookPreprocessing,
  queueWebhookExecution: mockQueueWebhookExecution,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  handleSlackChallenge: () => null,
  verifySlackRequestSignature: () => null,
  resolveSlackEventChannel: (event: Record<string, unknown> | undefined) => {
    if (!event) return undefined
    if (typeof event.channel === 'string') return event.channel
    const item = event.item as Record<string, unknown> | undefined
    return typeof item?.channel === 'string' ? item.channel : undefined
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  blockExistsInDeployment: mockBlockExistsInDeployment,
}))

import { POST } from '@/app/api/webhooks/slack/route'

const API_APP_ID = 'A_SELF'

function makeRequest() {
  return new Request('https://sim.test/api/webhooks/slack', {
    method: 'POST',
    headers: { 'x-slack-request-timestamp': '1700000000' },
  }) as unknown as import('next/server').NextRequest
}

function slackBody(event: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { team_id: 'T1', api_app_id: API_APP_ID, event, ...extra }
}

/** Drive the route with a single webhook whose providerConfig is `config`. */
async function fireWith(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<boolean> {
  mockParseWebhookBody.mockResolvedValue({ body, rawBody: JSON.stringify(body) })
  mockFindWebhooksByRoutingKey.mockResolvedValue([
    {
      webhook: { id: 'wh1', blockId: 'blk1', providerConfig: config },
      workflow: { id: 'wf1' },
    },
  ])
  mockCheckWebhookPreprocessing.mockResolvedValue({
    actorUserId: 'u1',
    executionId: 'e1',
    correlation: {},
  })
  mockBlockExistsInDeployment.mockResolvedValue(true)
  mockQueueWebhookExecution.mockClear()

  await POST(makeRequest())
  return mockQueueWebhookExecution.mock.calls.length > 0
}

describe('Slack app webhook route filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires a message event matching source=channel in a public channel', async () => {
    const fired = await fireWith(
      { eventType: 'message', source: ['channel'] },
      slackBody({ type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.1' })
    )
    expect(fired).toBe(true)
  })

  it('drops a DM when source is restricted to public channels', async () => {
    const fired = await fireWith(
      { eventType: 'message', source: ['channel'] },
      slackBody({ type: 'message', channel_type: 'im', channel: 'D1', ts: '1.1' })
    )
    expect(fired).toBe(false)
  })

  it('source=[public,private] fires on both channel types but drops DMs', async () => {
    const source = ['channel', 'group']
    const publicMsg = await fireWith(
      { eventType: 'message', source },
      slackBody({ type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.2' })
    )
    expect(publicMsg).toBe(true)

    const privateMsg = await fireWith(
      { eventType: 'message', source },
      slackBody({ type: 'message', channel_type: 'group', channel: 'G1', ts: '1.3' })
    )
    expect(privateMsg).toBe(true)

    const dm = await fireWith(
      { eventType: 'message', source },
      slackBody({ type: 'message', channel_type: 'im', channel: 'D1', ts: '1.4' })
    )
    expect(dm).toBe(false)
  })

  it('empty source matches any channel type', async () => {
    const dm = await fireWith(
      { eventType: 'message', source: [] },
      slackBody({ type: 'message', channel_type: 'im', channel: 'D1', ts: '1.5' })
    )
    expect(dm).toBe(true)
  })

  it('a channel filter never drops a DM allowed by Source', async () => {
    const config = { eventType: 'message', source: ['im', 'channel'], channelFilter: ['C1'] }
    // DM passes: the channel filter does not apply to DMs.
    const dm = await fireWith(
      config,
      slackBody({ type: 'message', channel_type: 'im', channel: 'D1', ts: '1.6' })
    )
    expect(dm).toBe(true)
    // Public message in the allowed channel fires.
    const inChannel = await fireWith(
      config,
      slackBody({ type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.7' })
    )
    expect(inChannel).toBe(true)
    // Public message in another channel is dropped by the channel filter.
    const otherChannel = await fireWith(
      config,
      slackBody({ type: 'message', channel_type: 'channel', channel: 'C2', ts: '1.8' })
    )
    expect(otherChannel).toBe(false)
  })

  it('app_mention Threads=Only fires only on threaded mentions', async () => {
    const topLevel = await fireWith(
      { eventType: 'app_mention', threads: 'only' },
      slackBody({ type: 'app_mention', channel: 'C1', ts: '2.0' })
    )
    expect(topLevel).toBe(false)

    const threaded = await fireWith(
      { eventType: 'app_mention', threads: 'only' },
      slackBody({ type: 'app_mention', channel: 'C1', ts: '2.1', thread_ts: '2.0' })
    )
    expect(threaded).toBe(true)
  })

  it('maps message_changed to message_edited and not to message', async () => {
    const editBody = slackBody({
      type: 'message',
      subtype: 'message_changed',
      channel_type: 'channel',
      channel: 'C1',
      ts: '3.1',
    })
    expect(await fireWith({ eventType: 'message_edited' }, editBody)).toBe(true)
    expect(await fireWith({ eventType: 'message' }, editBody)).toBe(false)
  })

  it("self-drops the app's own message unless includeOwnMessages is set", async () => {
    const ownBody = slackBody({
      type: 'message',
      channel_type: 'channel',
      channel: 'C1',
      ts: '4.1',
      app_id: API_APP_ID,
      bot_id: 'B1',
    })
    expect(await fireWith({ eventType: 'message' }, ownBody)).toBe(false)
    expect(await fireWith({ eventType: 'message', includeOwnMessages: true }, ownBody)).toBe(true)
  })

  it("self-drops the app's own reaction via stored bot_user_id", async () => {
    const body = slackBody({
      type: 'reaction_added',
      reaction: 'thumbsup',
      user: 'U_BOT',
      item: { channel: 'C1', ts: '5.0' },
    })
    expect(await fireWith({ eventType: 'reaction_added', bot_user_id: 'U_BOT' }, body)).toBe(false)
    expect(await fireWith({ eventType: 'reaction_added', bot_user_id: 'U_OTHER' }, body)).toBe(true)
  })

  it('applies the emoji filter to reaction events', async () => {
    const body = slackBody({
      type: 'reaction_added',
      reaction: 'eyes',
      user: 'U1',
      item: { channel: 'C1', ts: '6.0' },
    })
    expect(await fireWith({ eventType: 'reaction_added', emoji: 'thumbsup' }, body)).toBe(false)
    expect(await fireWith({ eventType: 'reaction_added', emoji: 'eyes, thumbsup' }, body)).toBe(
      true
    )
  })

  it('honors the legacy events array for pre-redesign webhooks', async () => {
    const fired = await fireWith(
      { events: ['message.channels'] },
      slackBody({ type: 'message', channel_type: 'channel', channel: 'C1', ts: '7.1' })
    )
    expect(fired).toBe(true)
  })

  it('ignores other bots but not our own drop path when filterBotMessages is on', async () => {
    const otherBot = slackBody({
      type: 'message',
      channel_type: 'channel',
      channel: 'C1',
      ts: '8.1',
      bot_id: 'B_OTHER',
      app_id: 'A_OTHER',
    })
    expect(await fireWith({ eventType: 'message' }, otherBot)).toBe(false)
    expect(await fireWith({ eventType: 'message', filterBotMessages: false }, otherBot)).toBe(true)
  })
})

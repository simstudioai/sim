/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slackConnectorMeta } from '@/connectors/slack/meta'
import { slackConnector } from '@/connectors/slack/slack'
import { CONNECTOR_TEXT_DOCUMENT_MAX_BYTES, PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const GENERAL = {
  id: 'C0GENERAL',
  name: 'general',
  topic: { value: 'Company-wide announcements' },
  purpose: { value: '' },
}
const PLATFORM = { id: 'G0PLATFORM', name: 'platform', topic: { value: '' } }

const MESSAGES = [
  { type: 'message', user: 'U2', text: 'Shipping today', ts: '1700000200.000100' },
  { type: 'message', user: 'U1', text: 'Morning', ts: '1700000100.000100' },
  { type: 'message', subtype: 'channel_join', user: 'U1', text: 'joined', ts: '1700000000.000100' },
]

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const requestedUrls: string[] = []
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

/** Channels returned by `conversations.list`; per-test overridable. */
let listedChannels: Record<string, unknown>[] = [GENERAL, PLATFORM]
/** `next_cursor` returned by `conversations.list`; per-test overridable. */
let listNextCursor = ''
/** Messages returned by `conversations.history`; per-test overridable. */
let history: Record<string, unknown>[] = MESSAGES
/** Whether `conversations.info` reports the channel as missing; per-test overridable. */
let channelMissing = false
/** The channel `conversations.info` returns; per-test overridable. */
let infoChannel: Record<string, unknown> = GENERAL

beforeEach(() => {
  requestedUrls.length = 0
  listedChannels = [GENERAL, PLATFORM]
  listNextCursor = ''
  history = MESSAGES
  channelMissing = false
  infoChannel = GENERAL
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))
    requestedUrls.push(`${url.pathname}?${url.searchParams.toString()}`)
    switch (url.pathname) {
      case '/api/auth.test':
        return jsonResponse({ ok: true, team_id: 'T0TEAM' })
      case '/api/conversations.list':
        return jsonResponse({
          ok: true,
          channels: listedChannels,
          response_metadata: { next_cursor: listNextCursor },
        })
      case '/api/conversations.info':
        return channelMissing
          ? jsonResponse({ ok: false, error: 'channel_not_found' })
          : jsonResponse({ ok: true, channel: infoChannel })
      case '/api/conversations.history':
        return jsonResponse({ ok: true, messages: history, response_metadata: {} })
      case '/api/users.info': {
        const id = url.searchParams.get('user')
        return jsonResponse({ ok: true, user: { id, name: id, real_name: `Person ${id}` } })
      }
      default:
        return jsonResponse({ ok: false, error: 'unknown_method' })
    }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const requested = (method: string) => requestedUrls.filter((url) => url.includes(`/${method}?`))

describe('slack connector meta', () => {
  it('crawls per member with the channel selection as the only listing cap', () => {
    expect(slackConnectorMeta.permissionScopedListing).toEqual({ capFieldIds: ['channel'] })
  })
})

describe('listDocuments', () => {
  it('lists configured channels as deferred stubs without reading their history', async () => {
    const syncContext: Record<string, unknown> = { syncRunId: 'run-1' }
    const result = await slackConnector.listDocuments(
      'token',
      { channel: ['C0GENERAL'] },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(result.documents).toEqual([
      expect.objectContaining({
        externalId: 'C0GENERAL',
        title: '#general',
        content: '',
        contentDeferred: true,
        estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
        contentHash: 'slack-listing:C0GENERAL:run-1',
        sourceUrl: 'https://app.slack.com/client/T0TEAM/C0GENERAL',
        metadata: expect.objectContaining({ channelName: 'general' }),
      }),
    ])
    expect(requested('conversations.history')).toHaveLength(0)
  })

  it('lists every readable channel when none is configured, paging through the cursor', async () => {
    listNextCursor = 'page-2'
    const syncContext: Record<string, unknown> = {
      syncRunId: 'run-1',
      ...PER_MEMBER_LISTING_CONTEXT,
    }
    const first = await slackConnector.listDocuments(
      'token',
      { channel: 0 },
      undefined,
      syncContext
    )

    expect(first.documents.map((doc) => doc.externalId)).toEqual(['C0GENERAL', 'G0PLATFORM'])
    expect(first).toMatchObject({ hasMore: true, nextCursor: 'page-2' })
    expect(requested('conversations.list')[0]).toContain('types=public_channel%2Cprivate_channel')
    expect(requested('conversations.list')[0]).toContain('exclude_archived=true')

    listNextCursor = ''
    listedChannels = []
    const second = await slackConnector.listDocuments(
      'token',
      { channel: 0 },
      'page-2',
      syncContext
    )
    expect(second).toEqual({ documents: [], nextCursor: undefined, hasMore: false })
    expect(requested('conversations.list')[1]).toContain('cursor=page-2')
  })

  it('gives every member of one run the same stub for a channel', async () => {
    const ada = await slackConnector.listDocuments('ada', {}, undefined, { syncRunId: 'run-7' })
    const bob = await slackConnector.listDocuments('bob', {}, undefined, { syncRunId: 'run-7' })
    expect(ada.documents[0].contentHash).toBe(bob.documents[0].contentHash)
  })

  it('changes the stub between runs so each run re-reads the channel', async () => {
    const first = await slackConnector.listDocuments('token', {}, undefined, {})
    const second = await slackConnector.listDocuments('token', {}, undefined, {})
    expect(first.documents[0].contentHash).not.toBe(second.documents[0].contentHash)
  })
})

describe('getDocument', () => {
  it('builds the transcript under a header with the real content hash', async () => {
    const doc = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})

    expect(doc).toMatchObject({
      externalId: 'C0GENERAL',
      title: '#general',
      contentHash: expect.stringMatching(
        /^slack-v3:C0GENERAL:[0-9a-f]{16}:1700000000\.000100:1700000200\.000100:3:noedit:noreply:0$/
      ),
      metadata: expect.objectContaining({ channelName: 'general', messageCount: 2 }),
    })
    expect(doc?.content).toBe(
      [
        'Channel: #general',
        'Topic: Company-wide announcements',
        '',
        '[2023-11-14T22:15:00.000Z] Person U1: Morning',
        '[2023-11-14T22:16:40.000Z] Person U2: Shipping today',
      ].join('\n')
    )
  })

  it('moves the hash when the header changes without any message changing', async () => {
    const before = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})

    infoChannel = { ...GENERAL, name: 'general-renamed' }
    const renamed = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})
    expect(renamed?.contentHash).not.toBe(before?.contentHash)

    infoChannel = { ...GENERAL, topic: { value: 'A new topic' } }
    const retopiced = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})
    expect(retopiced?.contentHash).not.toBe(before?.contentHash)

    infoChannel = GENERAL
    const again = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})
    expect(again?.contentHash).toBe(before?.contentHash)
  })

  it('keeps a channel with no messages as a live document', async () => {
    history = []
    const doc = await slackConnector.getDocument('token', {}, 'C0GENERAL', {})
    expect(doc?.content).toBe('Channel: #general\nTopic: Company-wide announcements\n')
    expect(doc?.metadata?.messageCount).toBe(0)
  })

  it('returns null only for a channel Slack no longer knows', async () => {
    channelMissing = true
    await expect(slackConnector.getDocument('token', {}, 'C0GONE', {})).resolves.toBeNull()
  })
})

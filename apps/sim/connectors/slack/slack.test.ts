/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slackConnectorMeta } from '@/connectors/slack/meta'
import { slackConnector } from '@/connectors/slack/slack'
import type { ExternalDocument } from '@/connectors/types'
import { CONNECTOR_TEXT_DOCUMENT_MAX_BYTES } from '@/connectors/utils'

const TEAM = 'T0TEAM'
const ROOT = '1700000100.000100'
const REPLY = '1700000200.000100'
const SECOND = '1700000300.000100'
const GENERAL = { id: 'C0GENERAL', name: 'general', is_archived: false }
const PRIVATE = { id: 'G0PRIVATE', name: 'private', is_archived: false }
const ARCHIVE = { id: 'C0ARCHIVE', name: 'archive', is_archived: true }
const id = (channel: string, ts = ROOT) => `slack:v4:${TEAM}:${channel}:${ts}`
const root = (text = 'Architecture decision') => ({
  type: 'message',
  user: 'U1',
  text,
  ts: ROOT,
  reply_count: 1,
})
const reply = (text = 'Use the queue') => ({
  type: 'message',
  user: 'U2',
  text,
  ts: REPLY,
  thread_ts: ROOT,
})

interface FixtureCall {
  method: string
  token: string
  params: URLSearchParams
}
interface ChannelFixture {
  channel: typeof GENERAL
  readers: string[]
  messages: Record<string, unknown>[]
  replies: Record<string, Record<string, unknown>[]>
}

let channels: ChannelFixture[]
let calls: FixtureCall[]
let pageSize: number
let failure: ((call: FixtureCall) => Record<string, unknown> | undefined) | undefined
let replacement: ((call: FixtureCall) => Record<string, unknown> | undefined) | undefined
let teams: Record<string, string>
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

/** Provider-level fixture: paginates collections and enforces token-specific channel access. */
function respond(call: FixtureCall): Record<string, unknown> {
  const override = failure?.(call) ?? replacement?.(call)
  if (override) return override
  const { method, token, params } = call
  if (method === 'auth.test') return { ok: true, team_id: teams[token] ?? TEAM }
  if (method === 'users.info')
    return { ok: true, user: { real_name: `Person ${params.get('user')}` } }
  const cursor = Number(params.get('cursor') || '0')
  const limit = Math.min(Number(params.get('limit') || pageSize), pageSize)
  const paginate = (items: Record<string, unknown>[], key: string) => ({
    ok: true,
    [key]: items.slice(cursor, cursor + limit),
    has_more: cursor + limit < items.length,
    response_metadata: { next_cursor: cursor + limit < items.length ? String(cursor + limit) : '' },
  })
  if (method === 'conversations.list') {
    return paginate(
      channels
        .filter(
          (entry) =>
            entry.readers.includes(token) &&
            (params.get('exclude_archived') !== 'true' || !entry.channel.is_archived)
        )
        .map((entry) => entry.channel),
      'channels'
    )
  }
  const entry = channels.find((item) => item.channel.id === params.get('channel'))
  if (!entry || !entry.readers.includes(token)) return { ok: false, error: 'channel_not_found' }
  if (method === 'conversations.info') return { ok: true, channel: entry.channel }
  if (method === 'conversations.history') {
    const oldest = Number(params.get('oldest') || '0')
    const latest = Number(params.get('latest') || Number.POSITIVE_INFINITY)
    return paginate(
      entry.messages.filter(
        (message) => Number(message.ts) >= oldest && Number(message.ts) <= latest
      ),
      'messages'
    )
  }
  if (method === 'conversations.replies') {
    const thread = entry.replies[params.get('ts') ?? '']
    return thread ? paginate(thread, 'messages') : { ok: false, error: 'thread_not_found' }
  }
  if (method === 'chat.getPermalink') {
    return {
      ok: true,
      permalink: `https://acme.slack.com/archives/${entry.channel.id}/p${params.get('message_ts')?.replace('.', '')}`,
    }
  }
  throw new Error(`Fixture has no Slack method ${method}`)
}

beforeEach(() => {
  channels = [
    {
      channel: GENERAL,
      readers: ['alice', 'bob'],
      messages: [root()],
      replies: { [ROOT]: [root(), reply()] },
    },
    {
      channel: PRIVATE,
      readers: ['alice'],
      messages: [root('Private decision')],
      replies: { [ROOT]: [root('Private decision'), reply('Confidential answer')] },
    },
    {
      channel: ARCHIVE,
      readers: ['alice'],
      messages: [root('Old decision')],
      replies: { [ROOT]: [root('Old decision')] },
    },
  ]
  calls = []
  pageSize = 200
  failure = undefined
  replacement = undefined
  teams = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? ''
    const call = { method: url.pathname.split('/').at(-1) ?? '', token, params: url.searchParams }
    calls.push(call)
    return json(respond(call))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function listAll(token: string, config: Record<string, unknown> = {}, run = 'run-1') {
  const context: Record<string, unknown> = { syncRunId: run }
  const documents: ExternalDocument[] = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page += 1) {
    const result = await slackConnector.listDocuments(token, config, cursor, context)
    documents.push(...result.documents)
    if (!result.hasMore) return { documents, context }
    expect(result.nextCursor).toBeTruthy()
    cursor = result.nextCursor
  }
  throw new Error('Fixture listing did not terminate')
}

describe('Slack thread indexing through provider APIs', () => {
  it('lists and hydrates whole threads with exact message links and one stable id per root', async () => {
    pageSize = 1
    const { documents, context } = await listAll('alice', { channel: GENERAL.id, maxMessages: 0 })
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ externalId: id(GENERAL.id), contentDeferred: true })
    expect(calls.filter((call) => call.method === 'conversations.replies')).toHaveLength(0)
    const document = await slackConnector.getDocument('alice', {}, documents[0].externalId, context)
    expect(document?.content).toContain('Architecture decision')
    expect(document?.content).toContain('Use the queue')
    expect(document?.sourceUrl).toBe('https://acme.slack.com/archives/C0GENERAL/p1700000100000100')
    expect(document?.metadata?.messageCount).toBe(2)
    expect(calls.filter((call) => call.method === 'conversations.replies')).toHaveLength(2)
    expect(
      calls.find((call) => call.method === 'chat.getPermalink')?.params.get('message_ts')
    ).toBe(ROOT)
  })

  it('keeps member listings isolated and withdraws documents when the provider removes channel access', async () => {
    const alice = await listAll('alice', { maxMessages: 0 })
    const bob = await listAll('bob', { maxMessages: 0 })
    expect(alice.documents.map((doc) => doc.externalId)).toContain(id(PRIVATE.id))
    expect(bob.documents.map((doc) => doc.externalId)).toEqual([id(GENERAL.id)])
    expect(alice.documents[0].contentHash).toBe(bob.documents[0].contentHash)
    channels[1].readers = []
    const afterRevocation = await listAll('alice', { maxMessages: 0 }, 'run-2')
    expect(afterRevocation.documents.map((doc) => doc.externalId)).not.toContain(id(PRIVATE.id))
    expect(afterRevocation.context.listingCapped).toBeUndefined()
    expect(await slackConnector.getDocument('alice', {}, id(PRIVATE.id))).toBeNull()
  })

  it('changes the text hash for reply edits/deletes and does not rewrite unchanged content', async () => {
    const before = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    const again = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    expect(again?.contentHash).toBe(before?.contentHash)
    channels[0].replies[ROOT] = [root(), reply('Use the corrected queue')]
    const edited = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    expect(edited?.contentHash).not.toBe(before?.contentHash)
    expect(edited?.content).toContain('corrected queue')
    channels[0].replies[ROOT] = [root()]
    const deleted = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    expect(deleted?.contentHash).not.toBe(edited?.contentHash)
    expect(deleted?.content).not.toContain('corrected queue')
    delete channels[0].replies[ROOT]
    channels[0].messages = []
    expect(await slackConnector.getDocument('alice', {}, id(GENERAL.id))).toBeNull()
    expect((await listAll('alice', { channel: GENERAL.id })).documents).toEqual([])
  })

  it('retires legacy channel ids and marks every thread for reply refresh on the next run', async () => {
    const first = await listAll('alice', { channel: GENERAL.id }, 'run-1')
    const next = await listAll('alice', { channel: GENERAL.id }, 'run-2')
    expect(first.documents.map((doc) => doc.externalId)).not.toContain(GENERAL.id)
    expect(first.documents[0].externalId).toBe(next.documents[0].externalId)
    expect(first.documents[0].contentHash).not.toBe(next.documents[0].contentHash)
    expect(await slackConnector.getDocument('alice', {}, GENERAL.id)).toBeNull()
  })

  it('preserves channel inclusion/exclusion and includes archived channels unless excluded', async () => {
    expect(slackConnectorMeta.permissionScopedListing).toEqual({ capFieldIds: ['maxMessages'] })
    expect(slackConnectorMeta.supportsSeparateContentCredential).toBe(true)
    const result = await listAll('alice', {
      channel: ['general', 'archive'],
      excludeChannels: '#general',
      maxMessages: 0,
    })
    expect(result.documents.map((doc) => doc.externalId)).toEqual([id(ARCHIVE.id)])
    expect(
      (await listAll('alice', { includeArchived: 'false', maxMessages: 0 })).documents.map(
        (doc) => doc.externalId
      )
    ).not.toContain(id(ARCHIVE.id))
    expect(
      calls
        .filter((call) => call.method === 'conversations.list')
        .every((call) => call.params.get('types') === 'public_channel,private_channel')
    ).toBe(true)
  })

  it('defines an explicit root-date scope without inventing a default lookback', async () => {
    await listAll('alice', { channel: GENERAL.id })
    expect(
      calls.find((call) => call.method === 'conversations.history')?.params.has('oldest')
    ).toBe(false)
    expect(
      (await listAll('alice', { channel: GENERAL.id, startDate: '2024-01-01' })).documents
    ).toEqual([])
    expect(
      await slackConnector.getDocument('alice', { startDate: '2024-01-01' }, id(GENERAL.id))
    ).toBeNull()
    expect(await slackConnector.validateConfig('alice', { startDate: '2024-02-30' })).toMatchObject(
      { valid: false }
    )
  })

  it('signals partial capped listings and fully reconciles when the configured cap was not reached', async () => {
    channels[0].messages = [{ ...root(), ts: SECOND }, root()]
    const capped = await listAll('alice', { channel: GENERAL.id, maxMessages: 1 })
    expect(capped.documents).toHaveLength(1)
    expect(capped.context.listingCapped).toBe(true)
    const full = await listAll('alice', { channel: GENERAL.id, maxMessages: 0 })
    expect(full.documents).toHaveLength(2)
    expect(full.context.listingCapped).toBeUndefined()
    const exact = await listAll('alice', { channel: GENERAL.id, maxMessages: 2 })
    expect(exact.context.listingCapped).toBeUndefined()
  })

  it('does not duplicate broadcast replies or index channel lifecycle noise', async () => {
    channels[0].messages = [
      { ...reply(), subtype: 'thread_broadcast' },
      root(),
      { type: 'message', subtype: 'channel_join', ts: SECOND, text: 'joined' },
    ]
    expect(
      (await listAll('alice', { channel: GENERAL.id })).documents.map((doc) => doc.externalId)
    ).toEqual([id(GENERAL.id)])
  })

  it('includes bot attachment and nested Block Kit text in thread content', async () => {
    channels[0].replies[ROOT] = [
      {
        ...root(),
        attachments: [
          {
            text: 'PR approved',
            blocks: [{ type: 'section', text: { type: 'plain_text', text: 'Deploy tonight' } }],
          },
        ],
      },
    ]
    const document = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    expect(document?.content).toContain('PR approved')
    expect(document?.content).toContain('Deploy tonight')
  })
})

describe('Slack incomplete and unsafe provider responses', () => {
  it('does not complete a member observation when channel access disappears between history pages', async () => {
    pageSize = 1
    channels[0].messages = [{ ...root(), ts: SECOND }, root()]
    failure = (call) =>
      call.method === 'conversations.history' && call.params.has('cursor')
        ? { ok: false, error: 'channel_not_found' }
        : undefined
    await expect(listAll('alice', { channel: GENERAL.id, maxMessages: 0 })).rejects.toThrow(
      'channel_not_found'
    )
  })

  it('refuses a cursor/document from another workspace', async () => {
    pageSize = 1
    const first = await slackConnector.listDocuments('alice', {}, undefined, {})
    teams.mallory = 'T0OTHER'
    await expect(slackConnector.listDocuments('mallory', {}, first.nextCursor, {})).rejects.toThrow(
      'another workspace'
    )
    await expect(slackConnector.getDocument('mallory', {}, id(GENERAL.id))).rejects.toThrow(
      'another workspace'
    )
  })

  it('fails the thread when any reply page fails, rather than indexing only the root', async () => {
    pageSize = 1
    failure = (call) =>
      call.method === 'conversations.replies' && call.params.has('cursor')
        ? { ok: false, error: 'missing_scope' }
        : undefined
    await expect(slackConnector.getDocument('alice', {}, id(GENERAL.id))).rejects.toThrow(
      'missing_scope'
    )
    expect(calls.some((call) => call.method === 'chat.getPermalink')).toBe(false)
  })

  it('does not turn malformed collections or missing pagination into authoritative emptiness', async () => {
    replacement = (call) => (call.method === 'conversations.history' ? { ok: true } : undefined)
    await expect(listAll('alice')).rejects.toThrow('invalid message page')
    replacement = (call) =>
      call.method === 'conversations.history'
        ? { ok: true, messages: [root()], has_more: true }
        : undefined
    await expect(listAll('alice')).rejects.toThrow('continuation cursor')
  })

  it('rejects repeated reply pages and provider retention truncation', async () => {
    replacement = (call) =>
      call.method === 'conversations.replies'
        ? { ok: true, messages: [root()], response_metadata: { next_cursor: 'again' } }
        : undefined
    await expect(slackConnector.getDocument('alice', {}, id(GENERAL.id))).rejects.toThrow(
      /duplicate|advance/
    )
    replacement = (call) =>
      call.method === 'conversations.history'
        ? { ok: true, messages: [root()], is_limited: true }
        : undefined
    expect((await listAll('alice', { channel: GENERAL.id })).context.listingCapped).toBe(true)
  })

  it.each(['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive'])(
    'identifies the provider rejection %s as invalid credentials',
    async (code) => {
      failure = () => ({ ok: false, error: code })
      const error = await listAll('alice').catch((error: unknown) => error)
      expect(slackConnector.isCredentialInvalidError?.(error)).toBe(true)
    }
  )

  it.each(['ratelimited', 'service_unavailable', 'internal_error', 'missing_scope'])(
    'does not invalidate a credential for %s',
    async (code) => {
      failure = () => ({ ok: false, error: code })
      const error = await listAll('alice').catch((error: unknown) => error)
      expect(slackConnector.isCredentialInvalidError?.(error)).toBe(false)
    }
  )

  it('propagates Slack envelope throttling so the sync scheduler can cool down', async () => {
    failure = (call) =>
      call.method === 'conversations.replies' ? { ok: false, error: 'ratelimited' } : undefined
    await expect(slackConnector.getDocument('alice', {}, id(GENERAL.id))).rejects.toMatchObject({
      rateLimited: true,
    })
  })

  it('refuses oversized thread text rather than silently indexing a partial answer', async () => {
    channels[0].replies[ROOT] = [root('x'.repeat(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES))]
    await expect(slackConnector.getDocument('alice', {}, id(GENERAL.id))).rejects.toThrow(
      /large|size|exceeds/i
    )
  })
})

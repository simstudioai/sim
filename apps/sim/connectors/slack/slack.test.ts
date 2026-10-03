import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slackConnector, slackRollingRefreshDay } from '@/connectors/slack/slack'
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
  channel: {
    id: string
    name?: string
    is_archived?: boolean
    is_im?: boolean
    is_mpim?: boolean
    user?: string
  }
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
            params
              .get('types')
              ?.split(',')
              .includes(
                entry.channel.is_im
                  ? 'im'
                  : entry.channel.is_mpim
                    ? 'mpim'
                    : entry.channel.id.startsWith('G')
                      ? 'private_channel'
                      : 'public_channel'
              ) &&
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
  vi.useRealTimers()
})

const DAY = 24 * 60 * 60 * 1000

/** Freezes the clock on a day that is not this thread's rolling reread, so it lists as quiet. */
function freezeOnQuietDay(externalId: string): void {
  const base = Date.UTC(2026, 0, 1)
  const offset = (slackRollingRefreshDay(externalId) + 1 - (Math.floor(base / DAY) % 28) + 28) % 28
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(base + offset * DAY)
}

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
  it('indexes personal and group DMs only when selected and only for their participants', async () => {
    pageSize = 1
    channels.push(
      {
        channel: { id: 'D0PRIVATE', is_im: true, user: 'U2' },
        readers: ['alice'],
        messages: [root('Private DM question')],
        replies: { [ROOT]: [root('Private DM question'), reply('Private DM answer')] },
      },
      {
        channel: { id: 'G0MPIM', name: 'mpdm-alice-bob', is_mpim: true },
        readers: ['alice', 'bob'],
        messages: [root('Group DM question')],
        replies: { [ROOT]: [root('Group DM question')] },
      }
    )
    expect(
      (await listAll('alice')).documents.some(
        (doc) => doc.externalId.includes('D0PRIVATE') || doc.externalId.includes('G0MPIM')
      )
    ).toBe(false)
    const config = { includeChannels: false, includeDirectMessages: true }
    const alice = await listAll('alice', config)
    expect(alice.documents.map((doc) => doc.externalId)).toEqual([id('D0PRIVATE'), id('G0MPIM')])
    expect((await listAll('bob', config)).documents.map((doc) => doc.externalId)).toEqual([
      id('G0MPIM'),
    ])
    const dm = await slackConnector.getDocument('alice', config, id('D0PRIVATE'), alice.context)
    expect(dm?.content).toContain('Private DM answer')
    expect(dm?.title).toContain('Direct message')
    expect(dm?.metadata?.conversationType).toBe('im')
    expect(dm?.sourceUrl).toBe('https://acme.slack.com/archives/D0PRIVATE/p1700000100000100')
    expect(await slackConnector.getDocument('bob', config, id('D0PRIVATE'))).toBeNull()
    expect(await slackConnector.getDocument('alice', {}, id('D0PRIVATE'))).toBeNull()
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
})

describe('Slack threads without indexable text', () => {
  beforeEach(() => {
    pageSize = 1
    channels = [
      {
        channel: GENERAL,
        readers: ['alice'],
        messages: [{ ...root(''), thread_ts: ROOT }],
        replies: { [ROOT]: [{ ...root(''), thread_ts: ROOT }, reply('')] },
      },
    ]
  })

  it('explicitly skips a listed thread only after reading all its reply pages', async () => {
    const listed = await listAll('alice')
    expect(listed.documents).toHaveLength(1)
    const document = await slackConnector.getDocument('alice', {}, id(GENERAL.id), listed.context)
    expect(document).toMatchObject({
      externalId: listed.documents[0].externalId,
      content: '',
      contentDeferred: false,
      skippedReason: 'Document contains no extractable text',
      skippedExistingDisposition: 'replace',
      metadata: { messageCount: 0, rootTs: ROOT, channelId: GENERAL.id, teamId: TEAM },
    })
    expect(calls.filter((call) => call.method === 'conversations.replies')).toHaveLength(2)
    expect(calls.some((call) => call.method === 'chat.getPermalink')).toBe(false)
  })

  it('does not classify a missing root as verified empty content', async () => {
    replacement = (call) =>
      call.method === 'conversations.replies' ? { ok: true, messages: [] } : undefined
    expect(await slackConnector.getDocument('alice', {}, id(GENERAL.id))).toBeNull()
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

  it('refuses oversized thread text rather than silently indexing a partial answer', async () => {
    channels[0].replies[ROOT] = [root('x'.repeat(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES))]
    await expect(slackConnector.getDocument('alice', {}, id(GENERAL.id))).rejects.toThrow(
      /large|size|exceeds/i
    )
  })
})

describe('Slack change detection and access scopes', () => {
  const match = (candidate: string, stored: string) =>
    slackConnector.matchContentHash?.(candidate, stored)
  const scope = (channel: string) => `slack:v4:${TEAM}:${channel}:`

  beforeEach(() => {
    freezeOnQuietDay(id(GENERAL.id))
  })

  it('rereads each quiet thread on exactly one day of every 28', async () => {
    const start = Date.now()
    const rereadDays: number[] = []
    for (let day = 0; day < 28; day += 1) {
      vi.setSystemTime(start + day * DAY)
      const listed = await listAll('alice', { channel: GENERAL.id }, `run-${day}`)
      if (listed.documents[0].contentHash.includes(':refresh:')) rereadDays.push(day)
    }
    expect(rereadDays).toHaveLength(1)
  })

  it('does not reread a quiet thread until its root reports a change', async () => {
    const first = await listAll('alice', { channel: GENERAL.id }, 'run-1')
    const stored = await slackConnector.getDocument('alice', {}, id(GENERAL.id), first.context)
    const next = await listAll('alice', { channel: GENERAL.id }, 'run-2')
    expect(match(next.documents[0].contentHash, stored?.contentHash ?? '')).toBe('current')
    channels[0].messages = [{ ...root(), reply_count: 2, latest_reply: SECOND }]
    const replied = await listAll('alice', { channel: GENERAL.id }, 'run-3')
    expect(match(replied.documents[0].contentHash, stored?.contentHash ?? '')).toBe('stale')
    channels[0].messages = [{ ...root(), edited: { ts: SECOND } }]
    const edited = await listAll('alice', { channel: GENERAL.id }, 'run-4')
    expect(match(edited.documents[0].contentHash, stored?.contentHash ?? '')).toBe('stale')
  })

  it('carries a thread indexed under the text-only hash forward without reindexing it', async () => {
    const hydrated = await slackConnector.getDocument('alice', {}, id(GENERAL.id))
    const text = hydrated?.contentHash.split(':').at(-1)
    expect(match(hydrated?.contentHash ?? '', `slack-content:v4:${text}`)).toBe('equivalent')
    expect(match(hydrated?.contentHash ?? '', `slack-content:v4:${'0'.repeat(64)}`)).toBe('stale')
    const listed = await listAll('alice', { channel: GENERAL.id })
    expect(match(listed.documents[0].contentHash, `slack-content:v4:${text}`)).toBe('stale')
  })

  it('reports exactly the conversations each member can read, under the listing rules', async () => {
    const listScopes = slackConnector.listAccessibleScopes
    if (!listScopes) throw new Error('Slack must report access scopes')
    const readAll = async (token: string, sourceConfig: Record<string, unknown>) => {
      const prefixes: string[] = []
      let cursor: string | undefined
      do {
        const page = await listScopes(token, sourceConfig, cursor)
        prefixes.push(...page.prefixes)
        cursor = page.nextCursor
      } while (cursor)
      return prefixes
    }
    pageSize = 1
    expect(await listScopes('alice', {})).toEqual({
      prefixes: [scope(GENERAL.id)],
      nextCursor: '1',
    })
    expect(await readAll('alice', {})).toEqual([
      scope(GENERAL.id),
      scope(PRIVATE.id),
      scope(ARCHIVE.id),
    ])
    expect(await readAll('bob', {})).toEqual([scope(GENERAL.id)])
    expect(
      await readAll('alice', { excludeChannels: '#general', includeArchived: 'false' })
    ).toEqual([scope(PRIVATE.id)])
    const listed = await listAll('alice', { maxMessages: 0 })
    const prefixes = await readAll('alice', {})
    expect(
      listed.documents.every((doc) => prefixes.some((prefix) => doc.externalId.startsWith(prefix)))
    ).toBe(true)
  })
})

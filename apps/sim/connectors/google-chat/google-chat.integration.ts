import { createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleChatConnector } from '@/connectors/google-chat/google-chat'

const SPACE = {
  name: 'spaces/fixture-space',
  displayName: 'Verification fixture',
  spaceType: 'SPACE',
  lastActiveTime: '2026-10-01T12:00:00Z',
}
const TOKEN = 'synthetic-google-chat-token'
const nativeFetch = globalThis.fetch
let origin = ''
let mode = ''
let messageReads = 0
let requestCount = 0
let firstParameters = ''
let now = Date.parse('2026-10-02T12:00:00Z')

const server = createServer((request, response) => {
  requestCount++
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const send = (data: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(data))
  }
  if (request.method !== 'GET' || request.headers.authorization !== `Bearer ${TOKEN}`) {
    send({}, 401)
    return
  }
  if (url.pathname === '/v1/spaces') {
    send({ spaces: [SPACE] })
    return
  }
  if (url.pathname === `/v1/${SPACE.name}`) {
    send(SPACE)
    return
  }
  if (url.pathname !== `/v1/${SPACE.name}/messages`) {
    send({}, 404)
    return
  }
  messageReads++
  const token = url.searchParams.get('pageToken')
  url.searchParams.delete('pageToken')
  if (!token) firstParameters = url.searchParams.toString()
  if (mode === 'stable-pages' && firstParameters !== url.searchParams.toString()) {
    send({ error: 'Continuation parameters changed' }, 400)
    return
  }
  if (mode === 'missing-first' || (mode === 'missing-later' && token)) {
    send({}, 404)
    return
  }
  if (mode.startsWith('denied-')) {
    send({}, Number(mode.slice(7)))
    return
  }
  if (mode === 'repeated-token' && messageReads > 4) {
    send({ error: 'Fixture detected an unbounded continuation' }, 400)
    return
  }
  if (mode === 'endless-empty') {
    if (messageReads > 205) {
      send({}, 400)
      return
    }
    send({ nextPageToken: `page-${messageReads + 1}` })
    return
  }
  if (mode === 'large-pages') {
    send({
      messages: [
        {
          name: `${SPACE.name}/messages/${messageReads}`,
          text: 'Large provider response',
          unusedPayload: 'x'.repeat(8 * 1024 * 1024),
        },
      ],
      nextPageToken: messageReads < 5 ? `page-${messageReads + 1}` : undefined,
    })
    return
  }
  if (mode === 'empty-page' && !token) {
    send({ nextPageToken: 'page-2' })
    return
  }
  const time = token ? '2026-09-30T12:00:00Z' : SPACE.lastActiveTime
  const cutoff = url.searchParams.get('filter')?.match(/"([^"]+)"/)?.[1]
  send({
    messages:
      cutoff && time <= cutoff
        ? []
        : [
            {
              name: `${SPACE.name}/messages/${token ? 'older' : 'newer'}`,
              sender: { name: 'users/fixture-author' },
              createTime: time,
              text: token ? 'Older decision: launch is paused.' : 'New decision: review on Friday.',
            },
          ],
    nextPageToken:
      mode === 'repeated-token' ? 'page-2' : token || mode === 'window' ? undefined : 'page-2',
  })
})

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture failed to bind')
  origin = `http://127.0.0.1:${address.port}`
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== 'https://chat.googleapis.com') throw new Error('Unexpected provider origin')
    return nativeFetch(`${origin}${url.pathname}${url.search}`, init)
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
  mode = ''
  messageReads = 0
  requestCount = 0
  firstParameters = ''
  now = Date.parse('2026-10-02T12:00:00Z')
})

afterAll(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const read = (config: Record<string, unknown> = {}, context?: Record<string, unknown>) =>
  googleChatConnector.getDocument(TOKEN, config, SPACE.name, context)

describe('Google Chat connector over real HTTP', () => {
  it.each(['missing-first', 'missing-later'])(
    'does not publish a replacement transcript after %s',
    async (failure) => {
      mode = failure
      await expect(read()).rejects.toThrow('404')
    }
  )

  it('bounds an endless sequence of empty pages instead of publishing an incomplete document', async () => {
    mode = 'endless-empty'
    await expect(read()).rejects.toThrow(/page limit/i)
    expect(messageReads).toBe(200)
  })

  it('bounds the combined provider payload across message pages', async () => {
    mode = 'large-pages'
    await expect(read()).rejects.toThrow(/maximum size/i)
    expect(messageReads).toBeLessThan(5)
  })

  it('retains messages across short pages without changing continuation parameters', async () => {
    mode = 'stable-pages'
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const document = await read({ maxMessages: '3', lookbackDays: '90' })
    expect(document?.metadata?.messageCount).toBe(2)
    expect(document?.content).toMatch(/Older decision:[\s\S]*New decision:/)
  })

  it('follows an empty intermediate page to its remaining messages', async () => {
    mode = 'empty-page'
    const document = await read()
    expect(document?.content).toContain('Older decision: launch is paused.')
  })

  it('rejects a repeated continuation without duplicating messages', async () => {
    mode = 'repeated-token'
    await expect(read()).rejects.toThrow(/repeated.*page|page.*repeated/i)
    expect(messageReads).toBe(2)
  })

  it('expires an inactive space message as the lookback advances and keeps one run consistent', async () => {
    mode = 'window'
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const config = { lookbackDays: '2' }
    const firstContext = {}
    const first = await googleChatConnector.listDocuments(TOKEN, config, undefined, firstContext)
    now += 60_000
    const initial = await read(config, firstContext)
    expect(initial?.content).toContain('New decision:')
    expect(initial?.contentHash).toBe(first.documents[0].contentHash)
    now += 3 * 24 * 60 * 60 * 1000
    const nextContext = {}
    const next = await googleChatConnector.listDocuments(TOKEN, config, undefined, nextContext)
    expect(next.documents[0].contentHash).not.toBe(first.documents[0].contentHash)
    const expired = await read(config, nextContext)
    expect(expired?.content).not.toContain('New decision:')
    expect(expired?.contentHash).toBe(next.documents[0].contentHash)
  })

  it.each([401, 403])('preserves HTTP %i authorization failures', async (status) => {
    mode = `denied-${status}`
    await expect(read()).rejects.toThrow(String(status))
  })

  it.each(['maxMessages', 'maxSpaces', 'lookbackDays'])(
    'rejects invalid %s before contacting the provider',
    async (field) => {
      for (const value of ['Infinity', '0.5', '9007199254740992']) {
        const result = await googleChatConnector.validateConfig(TOKEN, { [field]: value })
        expect(result.valid, `${field}=${value}`).toBe(false)
      }
      expect(requestCount).toBe(0)
    }
  )
})

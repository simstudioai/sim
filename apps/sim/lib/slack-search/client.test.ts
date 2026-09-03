/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLACK_SEARCH_MAX_LIMIT, SlackSearchError, searchSlack } from '@/lib/slack-search/client'

const MESSAGE = {
  author_name: 'Ada Lovelace',
  author_user_id: 'U1',
  channel_id: 'C0GENERAL',
  channel_name: 'general',
  message_ts: '1700000200.000100',
  content: 'The deploy is green',
  is_author_bot: false,
  permalink: 'https://example.slack.com/archives/C0GENERAL/p1700000200000100',
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

/** The body returned by `assistant.search.context`; per-test overridable. */
let responseBody: unknown = { ok: true, results: { messages: [MESSAGE] } }

function lastRequestBody(): URLSearchParams {
  const init = fetchMock.mock.calls.at(-1)?.[1]
  return new URLSearchParams(String(init?.body))
}

beforeEach(() => {
  responseBody = { ok: true, results: { messages: [MESSAGE] } }
  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchSlack', () => {
  it('asks Slack for messages across every conversation kind the person can read', async () => {
    await searchSlack({ accessToken: 'xoxp-token', query: '  deploy  ' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://slack.com/api/assistant.search.context')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer xoxp-token')

    const body = lastRequestBody()
    expect(body.get('query')).toBe('deploy')
    expect(body.get('content_types')).toBe('messages')
    expect(body.get('channel_types')).toBe('public_channel,private_channel,mpim,im')
    expect(body.get('include_context_messages')).toBe('true')
  })

  it('never asks for more than Slack will return', async () => {
    await searchSlack({ accessToken: 'token', query: 'deploy', limit: 500 })
    expect(lastRequestBody().get('limit')).toBe(String(SLACK_SEARCH_MAX_LIMIT))
  })

  it('reads nothing for an empty query', async () => {
    await expect(searchSlack({ accessToken: 'token', query: '   ' })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes a hit and reads it together with the messages around it', async () => {
    responseBody = {
      ok: true,
      results: {
        messages: [
          {
            ...MESSAGE,
            context_messages: {
              before: [{ text: 'Is staging up?' }],
              after: [{ text: 'Thanks!' }, { text: '   ' }],
            },
          },
        ],
      },
    }

    await expect(searchSlack({ accessToken: 'token', query: 'deploy' })).resolves.toEqual([
      {
        channelId: 'C0GENERAL',
        messageTs: '1700000200.000100',
        channelName: 'general',
        authorName: 'Ada Lovelace',
        text: 'Is staging up?\nThe deploy is green\nThanks!',
        permalink: MESSAGE.permalink,
        sentAt: new Date('2023-11-14T22:16:40.000Z'),
        isAuthorBot: false,
      },
    ])
  })

  it('drops a message that cannot be cited or has nothing to read', async () => {
    responseBody = {
      ok: true,
      results: {
        messages: [
          { ...MESSAGE, permalink: undefined },
          { ...MESSAGE, message_ts: undefined },
          { ...MESSAGE, content: '   ', context_messages: { before: [], after: [] } },
          MESSAGE,
        ],
      },
    }

    const results = await searchSlack({ accessToken: 'token', query: 'deploy' })
    expect(results).toHaveLength(1)
    expect(results[0].channelId).toBe('C0GENERAL')
  })

  it('keeps a result whose timestamp will not parse, without a date', async () => {
    responseBody = { ok: true, results: { messages: [{ ...MESSAGE, message_ts: 'not-a-ts' }] } }
    const results = await searchSlack({ accessToken: 'token', query: 'deploy' })
    expect(results).toHaveLength(1)
    expect(results[0].sentAt).toBeNull()
  })

  it('raises Slack’s own error code when it refuses', async () => {
    responseBody = { ok: false, error: 'missing_scope' }
    await expect(searchSlack({ accessToken: 'token', query: 'deploy' })).rejects.toThrow(
      SlackSearchError
    )
    await expect(searchSlack({ accessToken: 'token', query: 'deploy' })).rejects.toThrow(
      'missing_scope'
    )
  })

  it('raises for a transport failure, releasing the unread body', async () => {
    const response = new Response('nope', { status: 429 })
    const cancel = vi.spyOn(response.body as ReadableStream, 'cancel')
    fetchMock.mockResolvedValue(response)

    await expect(searchSlack({ accessToken: 'token', query: 'deploy' })).rejects.toThrow('http_429')
    expect(cancel).toHaveBeenCalled()
  })
})

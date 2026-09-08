/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertAssistantIntegrationCall,
  isAssistantIntegrationTool,
} from '@/lib/copilot/assistant/tool-policy'
import { executeSlackListConversationsOperation } from '@/lib/internal/slack/operations/list-conversations'
import { slackListChannelsTool } from '@/tools/slack/list_channels'
import type { SlackListChannelsParams } from '@/tools/slack/types'

const BASE_PARAMS: SlackListChannelsParams = {
  authMethod: 'oauth',
  accessToken: 'xoxp-token',
  botToken: '',
  credentialType: 'managed_oauth',
}

function slackResponse(body: Record<string, unknown>): Response {
  return Response.json(body)
}

describe('Slack list channels', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the internal operation boundary for a single page', () => {
    expect(slackListChannelsTool.operation.input).toBeTypeOf('function')
    expect(slackListChannelsTool.request).toBeUndefined()
    expect(slackListChannelsTool.oauth?.requiredScopes).toEqual([])
    expect(slackListChannelsTool.params).not.toHaveProperty('maxPages')
    expect(slackListChannelsTool.outputs).not.toHaveProperty('pages')
  })

  it('remains available through the caller’s own Assistant account without model-supplied tokens', () => {
    expect(isAssistantIntegrationTool(slackListChannelsTool)).toBe(true)
    expect(() =>
      assertAssistantIntegrationCall(slackListChannelsTool, {
        credentialId: 'my-slack-account',
        includePrivate: true,
        cursor: 'cursor-2',
      })
    ).not.toThrow()
    expect(() =>
      assertAssistantIntegrationCall(slackListChannelsTool, {
        credentialId: 'my-slack-account',
        accessToken: 'untrusted-token',
      })
    ).toThrow('Authentication comes from your connected account')
  })

  it('returns one page with conversation details and a cursor without fetching more', async () => {
    fetchMock.mockResolvedValueOnce(
      slackResponse({
        ok: true,
        channels: [
          {
            id: 'C123',
            name: 'general',
            is_channel: true,
            topic: { value: 'Company news' },
            purpose: { value: 'Announcements' },
          },
          {
            id: 'D123',
            is_im: true,
            user: 'U123',
            is_user_deleted: false,
          },
          {
            id: 'G123',
            name: 'mpdm-one--two-1',
            is_mpim: true,
            is_private: true,
          },
        ],
        response_metadata: { next_cursor: ' cursor-2 ' },
      })
    )

    const result = await executeSlackListConversationsOperation(BASE_PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(firstUrl.searchParams.get('types')).toBe('public_channel,private_channel')
    expect(firstUrl.searchParams.get('limit')).toBe('100')
    expect(firstUrl.searchParams.has('cursor')).toBe(false)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer xoxp-token'
    )
    expect(result).toEqual({
      success: true,
      output: {
        channels: [
          {
            id: 'C123',
            name: 'general',
            is_channel: true,
            topic: 'Company news',
            purpose: 'Announcements',
          },
          {
            id: 'D123',
            is_im: true,
            user: 'U123',
            is_user_deleted: false,
          },
          {
            id: 'G123',
            name: 'mpdm-one--two-1',
            is_mpim: true,
            is_private: true,
          },
        ],
        ids: ['C123', 'D123', 'G123'],
        names: ['general', 'mpdm-one--two-1'],
        count: 3,
        hasMore: true,
        nextCursor: 'cursor-2',
      },
    })
  })

  it.each([undefined, 'oauth', 'managed_oauth', 'service_account'])(
    'does not request DM scopes based on credential storage type %s',
    async (credentialType) => {
      fetchMock.mockImplementation(async () =>
        slackResponse({ ok: true, channels: [], response_metadata: { next_cursor: '' } })
      )

      await executeSlackListConversationsOperation({ ...BASE_PARAMS, credentialType })
      await executeSlackListConversationsOperation({
        ...BASE_PARAMS,
        credentialType,
        includePrivate: false,
      })

      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('types')).toBe(
        'public_channel,private_channel'
      )
      expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('types')).toBe(
        'public_channel'
      )
    }
  )

  it('fetches the next page only when the caller supplies the returned cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channels: [{ id: 'C1' }],
          response_metadata: { next_cursor: 'cursor-2' },
        })
      )
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channels: [{ id: 'C2' }],
          response_metadata: { next_cursor: '' },
        })
      )

    const legacyParams = { ...BASE_PARAMS, limit: 1, maxPages: 200 }
    const first = await executeSlackListConversationsOperation(legacyParams)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.output).toMatchObject({
      ids: ['C1'],
      count: 1,
      hasMore: true,
      nextCursor: 'cursor-2',
    })
    if (typeof first.output.nextCursor !== 'string') throw new Error('Expected a next cursor')

    const second = await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      cursor: ` ${first.output.nextCursor} `,
      limit: 1,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('cursor')).toBe(
      'cursor-2'
    )
    expect(second.output).toMatchObject({
      ids: ['C2'],
      count: 1,
      hasMore: false,
      nextCursor: null,
    })
  })

  it('returns the cursor even when Slack filters every conversation out of the page', async () => {
    fetchMock.mockResolvedValueOnce(
      slackResponse({ ok: true, channels: [], response_metadata: { next_cursor: 'cursor-2' } })
    )

    const result = await executeSlackListConversationsOperation(BASE_PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.output).toMatchObject({
      channels: [],
      count: 0,
      hasMore: true,
      nextCursor: 'cursor-2',
    })
  })

  it.each([undefined, { next_cursor: '' }, { next_cursor: ' ' }])(
    'returns no next cursor for an exhausted page with metadata %j',
    async (metadata) => {
      fetchMock.mockResolvedValueOnce(
        slackResponse({ ok: true, channels: [{ id: 'C1' }], response_metadata: metadata })
      )

      const result = await executeSlackListConversationsOperation(BASE_PARAMS)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(result.output).toMatchObject({ hasMore: false, nextCursor: null })
    }
  )

  it('throws rate-limit errors without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { ok: false, error: 'ratelimited' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    )

    await expect(executeSlackListConversationsOperation(BASE_PARAMS)).rejects.toThrow('ratelimited')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails fast on invalid pagination inputs before a provider request', async () => {
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, limit: 0 })
    ).rejects.toThrow('Conversation page size must be an integer between 1 and 200')
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, limit: 201 })
    ).rejects.toThrow('Conversation page size must be an integer between 1 and 200')
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, cursor: ' ' })
    ).rejects.toThrow('Pagination cursor is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses defaults for unresolved optional pagination values', async () => {
    fetchMock.mockResolvedValueOnce(
      slackResponse({ ok: true, channels: [], response_metadata: { next_cursor: '' } })
    )

    await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      limit: null as never,
    })

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('limit')).toBe('100')
  })

  it('does not call Slack for an aborted invocation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Cancelled'))

    await expect(
      executeSlackListConversationsOperation(BASE_PARAMS, controller.signal)
    ).rejects.toThrow('Cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails fast on malformed successful responses and repeated cursors', async () => {
    fetchMock.mockResolvedValueOnce(slackResponse({ ok: true }))
    await expect(executeSlackListConversationsOperation(BASE_PARAMS)).rejects.toThrow(
      'Slack returned a malformed conversations list'
    )

    fetchMock
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channels: [{ id: 'D123', is_im: 'true' }],
        })
      )
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: 'same-cursor' },
        })
      )
    await expect(executeSlackListConversationsOperation(BASE_PARAMS)).rejects.toThrow('is_im')
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, cursor: 'same-cursor' })
    ).rejects.toThrow('Slack returned a repeated conversation pagination cursor')

    fetchMock.mockResolvedValueOnce(
      slackResponse({
        ok: true,
        channels: [{ id: 'C1' }, { id: 'C2' }],
        response_metadata: { next_cursor: '' },
      })
    )
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, limit: 1 })
    ).rejects.toThrow('Slack returned more than the requested 1 conversations')
  })
})

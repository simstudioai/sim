/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('uses the internal operation boundary for bounded multi-page reads', () => {
    expect(slackListChannelsTool.operation.input).toBeTypeOf('function')
    expect(slackListChannelsTool.request).toBeUndefined()
    expect(slackListChannelsTool.params.maxPages).toMatchObject({
      type: 'number',
      required: false,
    })
  })

  it('continues after a short virtual page while Slack returns a cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(
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
          ],
          response_metadata: { next_cursor: ' cursor-2 ' },
        })
      )
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channels: [
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
          response_metadata: { next_cursor: '' },
        })
      )

    const result = await executeSlackListConversationsOperation(BASE_PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(firstUrl.searchParams.get('types')).toBe('public_channel,private_channel,im,mpim')
    expect(firstUrl.searchParams.get('limit')).toBe('100')
    expect(firstUrl.searchParams.has('cursor')).toBe(false)
    expect(secondUrl.searchParams.get('cursor')).toBe('cursor-2')
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
        hasMore: false,
        nextCursor: null,
        pages: 2,
      },
    })
  })

  it('keeps DM access and the private-channel toggle credential-aware', async () => {
    fetchMock.mockImplementation(async () =>
      slackResponse({ ok: true, channels: [], response_metadata: { next_cursor: '' } })
    )

    await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      credentialType: 'oauth',
    })
    await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      includePrivate: false,
    })

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('types')).toBe(
      'public_channel,private_channel'
    )
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('types')).toBe(
      'public_channel,im,mpim'
    )
  })

  it('stops at maxPages and returns a resumable cursor', async () => {
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
          response_metadata: { next_cursor: 'cursor-3' },
        })
      )

    const result = await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      cursor: 'cursor-1',
      limit: 1,
      maxPages: 2,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('cursor')).toBe(
      'cursor-1'
    )
    expect(result.output).toMatchObject({
      ids: ['C1', 'C2'],
      count: 2,
      hasMore: true,
      nextCursor: 'cursor-3',
      pages: 2,
    })
  })

  it('continues beyond ten pages by default until Slack exhausts its cursor', async () => {
    fetchMock.mockImplementation(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      const page = cursor ? Number(cursor.replace('cursor-', '')) : 1
      return slackResponse({
        ok: true,
        channels: [{ id: `C${page}` }],
        response_metadata: { next_cursor: page < 12 ? `cursor-${page + 1}` : '' },
      })
    })

    const result = await executeSlackListConversationsOperation(BASE_PARAMS)

    expect(fetchMock).toHaveBeenCalledTimes(12)
    expect(result.output).toMatchObject({
      count: 12,
      hasMore: false,
      nextCursor: null,
      pages: 12,
    })
  })

  it('stops at 10,000 conversations and preserves the cursor for resumption', async () => {
    fetchMock.mockImplementation(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      const page = cursor ? Number(cursor.replace('cursor-', '')) : 1
      return slackResponse({
        ok: true,
        channels: Array.from({ length: 200 }, (_, index) => ({ id: `C${page}-${index}` })),
        response_metadata: { next_cursor: `cursor-${page + 1}` },
      })
    })

    const result = await executeSlackListConversationsOperation({
      ...BASE_PARAMS,
      limit: 200,
    })

    expect(fetchMock).toHaveBeenCalledTimes(50)
    expect(result.output).toMatchObject({
      count: 10_000,
      hasMore: true,
      nextCursor: 'cursor-51',
      pages: 50,
    })
  })

  it('fails fast on invalid pagination inputs before a provider request', async () => {
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, limit: 0 })
    ).rejects.toThrow('Conversation page size must be an integer between 1 and 200')
    await expect(
      executeSlackListConversationsOperation({ ...BASE_PARAMS, maxPages: 201 })
    ).rejects.toThrow('Maximum conversation pages must be an integer between 1 and 200')
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
      maxPages: ' ' as never,
    })

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('limit')).toBe('100')
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

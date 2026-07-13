/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_ERROR_BODY_BYTES } from '@/lib/core/utils/stream-limits'
import { instagramGetConversationMessagesTool } from '@/tools/instagram/get_conversation_messages'
import { instagramGetMessageTool } from '@/tools/instagram/get_message'
import { INSTAGRAM_RESPONSE_MAX_BYTES } from '@/tools/instagram/utils'

describe('instagramGetConversationMessagesTool', () => {
  it('applies limit and cursor to the nested messages connection', () => {
    const buildUrl = instagramGetConversationMessagesTool.request.url
    if (typeof buildUrl !== 'function') throw new Error('Expected a dynamic request URL')

    const url = new URL(
      buildUrl({
        accessToken: 'token',
        conversationId: ' conversation-1 ',
        limit: 7,
        after: ' cursor-2 ',
      })
    )

    expect(url.pathname.endsWith('/conversation-1')).toBe(true)
    expect(url.searchParams.get('fields')).toBe(
      'messages.limit(7).after(cursor-2){id,created_time,is_unsupported}'
    )
  })

  it('maps documented message fields and nested pagination', async () => {
    const result = await instagramGetConversationMessagesTool.transformResponse?.(
      Response.json({
        messages: {
          data: [
            {
              id: 'message-1',
              created_time: '2025-07-28T22:44:49+0000',
              is_unsupported: true,
            },
            { id: 2, created_time: '2025-07-28T21:20:58+0000', is_unsupported: false },
            { created_time: '2025-07-28T21:20:13+0000' },
          ],
          paging: {
            cursors: { after: 'next-message-cursor' },
            next: 'https://graph.instagram.com/next',
          },
        },
        id: 'conversation-1',
      }),
      { accessToken: 'token', conversationId: ' conversation-1 ' }
    )

    expect(result).toEqual({
      success: true,
      output: {
        conversationId: 'conversation-1',
        messages: [
          {
            id: 'message-1',
            createdTime: '2025-07-28T22:44:49+0000',
            isUnsupported: true,
          },
          {
            id: '2',
            createdTime: '2025-07-28T21:20:58+0000',
            isUnsupported: false,
          },
        ],
        nextCursor: 'next-message-cursor',
      },
    })
    expect(instagramGetConversationMessagesTool.outputs?.messages.type).toBe('array')
    expect(instagramGetConversationMessagesTool.outputs?.messages.items?.properties).toHaveProperty(
      'isUnsupported'
    )
  })

  it('rejects oversized Graph response bodies', async () => {
    const transform = instagramGetConversationMessagesTool.transformResponse
    if (!transform) throw new Error('Expected a response transform')

    await expect(
      transform(
        Response.json({
          messages: { data: [] },
          padding: 'x'.repeat(INSTAGRAM_RESPONSE_MAX_BYTES + 1),
        }),
        { accessToken: 'token', conversationId: 'conversation-1' }
      )
    ).rejects.toThrow(
      `Instagram conversation messages response exceeds maximum size of ${INSTAGRAM_RESPONSE_MAX_BYTES} bytes`
    )
  })

  it('allows success responses above the smaller Graph error-body cap', async () => {
    const transform = instagramGetConversationMessagesTool.transformResponse
    if (!transform) throw new Error('Expected a response transform')

    const result = await transform(
      Response.json({
        id: 'conversation-1',
        messages: { data: [] },
        padding: 'x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1),
      }),
      { accessToken: 'token', conversationId: 'conversation-1' }
    )

    expect(result).toMatchObject({
      success: true,
      output: { conversationId: 'conversation-1', messages: [] },
    })
  })

  it('rejects malformed successful Graph responses', async () => {
    const transform = instagramGetConversationMessagesTool.transformResponse
    if (!transform) throw new Error('Expected a response transform')

    await expect(
      transform(new Response('{not-json', { status: 200 }), {
        accessToken: 'token',
        conversationId: 'conversation-1',
      })
    ).rejects.toThrow()
  })

  it('preserves Graph provider error metadata', async () => {
    const result = await instagramGetConversationMessagesTool.transformResponse?.(
      Response.json(
        {
          error: {
            message: 'Bad request',
            type: 'OAuthException',
            code: 100,
            error_subcode: 33,
            fbtrace_id: 'trace-1',
          },
        },
        { status: 400 }
      ),
      { accessToken: 'token', conversationId: 'conversation-1' }
    )

    expect(result?.error).toBe(
      'Bad request (type OAuthException, code 100, subcode 33, trace trace-1)'
    )
  })

  it('caps Graph error bodies at the shared error-response limit', async () => {
    const result = await instagramGetConversationMessagesTool.transformResponse?.(
      Response.json(
        { error: { message: 'x'.repeat(DEFAULT_MAX_ERROR_BODY_BYTES + 1) } },
        { status: 400, statusText: 'Bad Request' }
      ),
      { accessToken: 'token', conversationId: 'conversation-1' }
    )

    expect(result?.error).toBe('Bad Request')
  })
})

describe('instagramGetMessageTool', () => {
  it('maps the documented sender username', async () => {
    const result = await instagramGetMessageTool.transformResponse?.(
      Response.json({
        id: 'message-1',
        created_time: '2025-07-28T22:44:49+0000',
        from: { id: 'sender-1', username: 'sender.username' },
        to: { data: [{ id: 'recipient-1', username: 'recipient.username' }] },
        message: 'Hello',
      })
    )

    expect(result?.output).toMatchObject({
      id: 'message-1',
      fromId: 'sender-1',
      fromUsername: 'sender.username',
      toId: 'recipient-1',
      message: 'Hello',
    })
  })
})

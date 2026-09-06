/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { slackListChannelsTool } from '@/tools/slack/list_channels'
import type { SlackListChannelsParams } from '@/tools/slack/types'

const BASE_PARAMS: SlackListChannelsParams = {
  authMethod: 'oauth',
  accessToken: 'xoxp-token',
  botToken: '',
}

function requestUrl(params: SlackListChannelsParams): URL {
  const value = slackListChannelsTool.request.url
  return new URL(typeof value === 'function' ? value(params) : value)
}

describe('Slack list channels', () => {
  it.each([undefined, 'oauth', 'managed_oauth', 'service_account'])(
    'does not request DM scopes based on credential storage type %s',
    (credentialType) => {
      const params = { ...BASE_PARAMS, credentialType }
      expect(requestUrl(params).searchParams.get('types')).toBe('public_channel,private_channel')
      expect(requestUrl({ ...params, includePrivate: false }).searchParams.get('types')).toBe(
        'public_channel'
      )
    }
  )

  it('rejects invalid limits and empty cursors before the provider request', () => {
    expect(() => requestUrl({ ...BASE_PARAMS, limit: 0 })).toThrow(
      'Channel limit must be an integer between 1 and 200'
    )
    expect(() => requestUrl({ ...BASE_PARAMS, cursor: ' ' })).toThrow(
      'Pagination cursor is required'
    )
  })

  it('uses the default limit for unresolved optional workflow values', () => {
    expect(requestUrl({ ...BASE_PARAMS, limit: null as never }).searchParams.get('limit')).toBe(
      '100'
    )
    expect(requestUrl({ ...BASE_PARAMS, limit: ' ' as never }).searchParams.get('limit')).toBe(
      '100'
    )
  })

  it('preserves the documented type and participant fields for mixed conversations', async () => {
    const result = await slackListChannelsTool.transformResponse!(
      Response.json({
        ok: true,
        channels: [
          {
            id: 'C123',
            name: 'general',
            is_channel: true,
            is_im: false,
            is_mpim: false,
            is_private: false,
            is_archived: false,
            is_member: true,
            topic: { value: 'Company news' },
            purpose: { value: 'Announcements' },
          },
          {
            id: 'D123',
            is_im: true,
            is_org_shared: false,
            user: 'U123',
            is_user_deleted: false,
            created: 1_498_500_348,
            priority: 0,
          },
          {
            id: 'G123',
            name: 'mpdm-one--two-1',
            is_group: true,
            is_im: false,
            is_mpim: true,
            is_private: true,
            is_open: true,
            creator: 'U456',
          },
        ],
        response_metadata: { next_cursor: ' next-page ' },
      })
    )

    expect(result.output).toEqual({
      channels: [
        {
          id: 'C123',
          name: 'general',
          is_channel: true,
          is_im: false,
          is_mpim: false,
          is_private: false,
          is_archived: false,
          is_member: true,
          topic: 'Company news',
          purpose: 'Announcements',
        },
        {
          id: 'D123',
          is_im: true,
          user: 'U123',
          is_user_deleted: false,
          is_org_shared: false,
          created: 1_498_500_348,
          priority: 0,
        },
        {
          id: 'G123',
          name: 'mpdm-one--two-1',
          is_group: true,
          is_im: false,
          is_mpim: true,
          is_private: true,
          is_open: true,
          creator: 'U456',
        },
      ],
      ids: ['C123', 'D123', 'G123'],
      names: ['general', 'mpdm-one--two-1'],
      count: 3,
      nextCursor: 'next-page',
    })
  })

  it('fails fast on malformed successful responses', async () => {
    await expect(
      slackListChannelsTool.transformResponse!(Response.json({ ok: true }))
    ).rejects.toThrow('Slack returned a malformed conversations list')
    await expect(
      slackListChannelsTool.transformResponse!(
        Response.json({ ok: true, channels: [{ id: 'D123', is_im: 'true' }] })
      )
    ).rejects.toThrow('is_im')
  })
})

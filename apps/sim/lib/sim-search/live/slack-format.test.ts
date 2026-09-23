/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { readSlack, searchSlack } from '@/lib/sim-search/live/slack'
import {
  slackConversationName,
  slackConversationUrl,
  slackPlainText,
} from '@/lib/sim-search/live/slack-format'

describe('Slack search presentation', () => {
  it('names group DMs and channels without leaking internal slugs', () => {
    expect(slackConversationName('mpdm-waleed--vikhyath--sid-1')).toBe(
      'Group DM · Waleed, Vikhyath, Sid'
    )
    expect(slackConversationName('mpdm-marcus.arkan--mary-jane-2')).toBe(
      'Group DM · Marcus Arkan, Mary-Jane'
    )
    expect(slackConversationName('west-internal', 'C1')).toBe('#west-internal')
    expect(slackConversationName('vikhyath', 'D1')).toBe('DM · Vikhyath')
    expect(slackConversationName('D1', 'D1')).toBe('Direct message')
  })
  it('uses provider mention labels, known authors, and honest unknown-user fallbacks', () => {
    expect(
      slackPlainText('<@U1|Vikhyath Mondreti> &amp; <@U2> <@U3>', new Map([['U2', 'Sid']]))
    ).toBe('@Vikhyath Mondreti & @Sid @Slack member')
    expect(slackPlainText('<#G1|mpdm-waleed--sid-1> <!here> <https://example.com|Plan>')).toBe(
      'Group DM · Waleed, Sid @here Plan (https://example.com)'
    )
    expect(slackPlainText('a &lt; b &amp; c &gt; d')).toBe('a < b & c > d')
  })
  it('only derives conversation links from valid returned Slack destinations', () => {
    expect(slackConversationUrl('https://sim.slack.com/archives/G123/p456', 'G123')).toBe(
      'https://sim.slack.com/archives/G123'
    )
    for (const url of [
      'javascript:alert(1)',
      'https://evilslack.com/x',
      'https://user:password@sim.slack.com/x',
    ])
      expect(slackConversationUrl(url, 'G123')).toBeUndefined()
  })
  it('normalizes results and context with the same single RTS request', async () => {
    const api = {
      json: vi.fn().mockResolvedValue({
        ok: true,
        results: {
          messages: [
            {
              message_ts: '123.456',
              channel_id: 'G123',
              channel_name: 'mpdm-waleed--sid-1',
              author_name: 'Sid',
              author_user_id: 'U1',
              content: '<@U2|Waleed> see <@U1>',
              permalink: 'https://sim.slack.com/archives/G123/p123456',
              context_messages: { before: [{ text: '<@U1> hello' }] },
            },
          ],
        },
      }),
      text: vi.fn(),
    }
    const result = await searchSlack(api, {
      query: 'hello',
      limit: 20,
      scopes: ['search:read.public', 'search:read.mpim'],
    })
    expect(api.json).toHaveBeenCalledTimes(1)
    expect(result.documents[0]).toMatchObject({
      title: 'Group DM · Waleed, Sid',
      content: '@Sid hello\n@Waleed see @Sid',
      author: 'Sid',
      containerUrl: 'https://sim.slack.com/archives/G123',
    })
  })
  it('cleans a full message read without adding provider lookups', async () => {
    const api = {
      json: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          messages: [
            { text: '<@U2|Waleed> hello', user: 'U1', user_profile: { display_name: 'Sid' } },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          permalink: 'https://sim.slack.com/archives/G1/p123456',
        }),
      text: vi.fn(),
    }
    const result = await readSlack(api, '123.456', 'G1')
    expect(result.content).toBe('Sid: @Waleed hello')
    expect(result.title).toBe('Slack conversation')
    expect(api.json).toHaveBeenCalledTimes(2)
  })
})

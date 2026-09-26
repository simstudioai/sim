import { describe, expect, it, vi } from 'vitest'
import { readSlack } from '@/lib/sim-search/live/slack'
import { slackConversationName, slackConversationUrl } from '@/lib/sim-search/live/slack-format'

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
  it('does not let an aborted name lookup pass as a missing name', async () => {
    const aborted = new DOMException('aborted', 'AbortError')
    const api = {
      json: vi.fn(async (path: string) => {
        if (path === '/api/conversations.replies')
          return { ok: true, messages: [{ text: 'hi', user: 'U1' }] }
        if (path === '/api/chat.getPermalink')
          return { ok: true, permalink: 'https://sim.slack.com/archives/D1/p123456' }
        throw aborted
      }),
      text: vi.fn(),
    }
    await expect(readSlack(api, '123.456', 'D1')).rejects.toBe(aborted)
  })
})

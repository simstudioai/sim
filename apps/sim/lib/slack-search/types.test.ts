/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseSlackSearchMessage } from '@/lib/slack-search/types'

const now = 1_800_000_000_000
const event = {
  type: 'message',
  ts: '1800000000.123456',
  channel_type: 'im',
  channel: 'D123',
  user: 'W123',
  text: '  release notes  ',
}
const envelope = {
  type: 'event_callback',
  team_id: 'T1',
  api_app_id: 'A1',
  event_id: 'Ev1',
  event_time: now / 1000,
  event,
}

describe('Slack Search message dispatch', () => {
  it.each(['C123', 'G123'])(
    'accepts explicit mentions in %s and retains their source thread',
    (channel) => {
      expect(
        parseSlackSearchMessage(
          {
            ...envelope,
            event: {
              ...event,
              type: 'app_mention',
              channel,
              channel_type: undefined,
              thread_ts: '12.34',
            },
          },
          now
        )
      ).toMatchObject({
        channelId: channel,
        threadTs: undefined,
        origin: { channelId: channel, threadTs: '12.34', messageTs: event.ts },
      })
      expect(
        parseSlackSearchMessage(
          { ...envelope, event: { ...event, type: 'message', channel, channel_type: 'channel' } },
          now
        )
      ).toBeNull()
    }
  )
  it('normalizes a human DM and preserves an existing thread', () => {
    expect(
      parseSlackSearchMessage({ ...envelope, event: { ...event, thread_ts: '12.34' } }, now)
    ).toEqual({
      appId: 'A1',
      teamId: 'T1',
      eventId: 'Ev1',
      channelId: 'D123',
      userId: 'W123',
      query: 'release notes',
      queryTooLong: false,
      messageTs: '1800000000.123456',
      threadTs: '12.34',
    })
  })
  it.each([
    { type: 'app_home_opened', tab: 'messages' },
    { channel_type: 'channel' },
    { channel_type: 'mpim' },
    { bot_id: 'B1' },
    { bot_profile: {} },
    { subtype: 'message_changed' },
    { subtype: 'message_deleted' },
    { user_team: 'T2' },
    { text: '  ' },
  ])('ignores non-search messages: %j', (change) => {
    expect(parseSlackSearchMessage({ ...envelope, event: { ...event, ...change } }, now)).toBeNull()
  })
  it('accepts file captions without forwarding attachments', () => {
    const result = parseSlackSearchMessage(
      {
        ...envelope,
        event: { ...event, subtype: 'file_share', files: [{ url_private: 'secret' }] },
      },
      now
    )
    expect(result?.query).toBe('release notes')
    expect(result).not.toHaveProperty('files')
  })
  it('bounds oversized text before persisting a job', () => {
    expect(
      parseSlackSearchMessage({ ...envelope, event: { ...event, text: 'x'.repeat(2001) } }, now)
    ).toMatchObject({ query: '', queryTooLong: true })
  })
  it('rejects deliveries older than the queue deduplication window', () => {
    expect(parseSlackSearchMessage(envelope, now + 24 * 60 * 60 * 1000)).toBeNull()
  })
  it('ignores button interactions without starting a search', () => {
    expect(
      parseSlackSearchMessage(
        { type: 'block_actions', actions: [{ action_id: 'sim_search.open_search' }] },
        now
      )
    ).toBeNull()
  })
})

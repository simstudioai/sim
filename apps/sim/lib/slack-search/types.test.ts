/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { parseSlackSearchMessage } from '@/lib/slack-search/types'

const now = 1_800_000_000_000
const event = {
  type: 'message',
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
      threadTs: '12.34',
    })
  })
  it.each([
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

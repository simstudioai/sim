/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  slackSearchConversationKey,
  slackSearchConversationSchema,
} from '@/lib/slack-search/conversation'

describe('Slack conversation identity', () => {
  it('isolates installations and channels even with an identical thread timestamp', () => {
    const keys = [
      slackSearchConversationKey('installation-1', 'D1', '1800000000.1'),
      slackSearchConversationKey('installation-2', 'D1', '1800000000.1'),
      slackSearchConversationKey('installation-1', 'D2', '1800000000.1'),
    ]
    expect(new Set(keys).size).toBe(3)
  })
  it('does not alias identifiers containing separators', () => {
    expect(slackSearchConversationKey('a:b', 'c', '1.1')).not.toBe(
      slackSearchConversationKey('a', 'b:c', '1.1')
    )
  })
  it('rejects corrupt or non-DM binding metadata', () => {
    const metadata = {
      type: 'slack',
      installationId: 'i1',
      channelId: 'D1',
      threadTs: '1800000000.1',
      slackUserId: 'U1',
      lastStopTs: null,
    }
    expect(slackSearchConversationSchema.safeParse(metadata).success).toBe(true)
    expect(slackSearchConversationSchema.safeParse({ ...metadata, channelId: 'C1' }).success).toBe(
      false
    )
    expect(slackSearchConversationSchema.safeParse({ ...metadata, slackUserId: '' }).success).toBe(
      false
    )
    expect(
      slackSearchConversationSchema.safeParse({ ...metadata, lastStopTs: 'invalid' }).success
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  classifySlackPayload,
  evaluateSlackV2Match,
  selfIdentityFromEnvelope,
} from '@/triggers/slack/utils'

const SELF = { botUserId: 'U_SELF', botId: 'B_SELF', appId: 'A_SELF' }

function messageEvent(
  overrides: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {}
) {
  return {
    team_id: 'T1',
    api_app_id: 'A_SELF',
    event_id: 'Ev1',
    event: {
      type: 'message',
      channel: 'C123',
      channel_type: 'channel',
      user: 'U_HUMAN',
      text: 'hello',
      ts: '1700000000.000100',
      ...overrides,
    },
    ...envelope,
  }
}

/** Default config: all message-family capabilities on, like the default UI. */
const baseConfig: Record<string, unknown> = {
  trigger_mention: true,
  trigger_dm: true,
  trigger_group_dm: true,
  trigger_public_channel: true,
  trigger_private_channel: true,
  trigger_reaction: true,
}

describe('classifySlackPayload', () => {
  it('classifies events, slash commands, and interactivity', () => {
    expect(classifySlackPayload(messageEvent()).kind).toBe('message')
    expect(classifySlackPayload(messageEvent({ type: 'app_mention' })).kind).toBe('app_mention')
    expect(classifySlackPayload({ command: '/elder', channel_id: 'C1' }).kind).toBe('slash_command')
    expect(classifySlackPayload({ type: 'block_actions', actions: [] }).kind).toBe('block_action')
    expect(classifySlackPayload({ type: 'message_action', callback_id: 'x' }).kind).toBe('shortcut')
    expect(
      classifySlackPayload({
        event: {
          type: 'assistant_thread_started',
          assistant_thread: { channel_id: 'D1', thread_ts: '1.2', user_id: 'U1' },
        },
      }).kind
    ).toBe('assistant_thread_started')
  })

  it('classifies reaction events with the item channel', () => {
    const c = classifySlackPayload({
      event: {
        type: 'reaction_added',
        user: 'U1',
        reaction: 'eyes',
        item: { channel: 'C9', ts: '1.1' },
      },
    })
    expect(c.kind).toBe('reaction')
    expect(c.channelId).toBe('C9')
  })
})

describe('selfIdentityFromEnvelope', () => {
  it('extracts the bot user from authorizations', () => {
    const identity = selfIdentityFromEnvelope({
      api_app_id: 'A_SELF',
      authorizations: [{ user_id: 'U_SELF', is_bot: true }],
    })
    expect(identity).toEqual({ appId: 'A_SELF', botUserId: 'U_SELF' })
  })

  it('ignores non-bot authorizations', () => {
    const identity = selfIdentityFromEnvelope({
      authorizations: [{ user_id: 'U_HUMAN', is_bot: false }],
    })
    expect(identity.botUserId).toBeUndefined()
  })
})

describe('evaluateSlackV2Match', () => {
  it('passes a plain human channel message', () => {
    expect(evaluateSlackV2Match(messageEvent(), baseConfig, SELF).pass).toBe(true)
  })

  it('drops event types that are not opted in', () => {
    const config = { ...baseConfig, trigger_public_channel: false }
    const result = evaluateSlackV2Match(messageEvent(), config, SELF)
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('not opted in')
  })

  it('uses capability defaults when config omits the key (slash off by default)', () => {
    const result = evaluateSlackV2Match({ command: '/x', channel_id: 'C1' }, {}, SELF)
    expect(result.pass).toBe(false)
  })

  it('drops noise subtypes by default but keeps file_share and thread_broadcast', () => {
    expect(
      evaluateSlackV2Match(messageEvent({ subtype: 'channel_join' }), baseConfig, SELF).pass
    ).toBe(false)
    expect(
      evaluateSlackV2Match(messageEvent({ subtype: 'message_changed' }), baseConfig, SELF).pass
    ).toBe(false)
    expect(
      evaluateSlackV2Match(messageEvent({ subtype: 'file_share' }), baseConfig, SELF).pass
    ).toBe(true)
    expect(
      evaluateSlackV2Match(messageEvent({ subtype: 'thread_broadcast' }), baseConfig, SELF).pass
    ).toBe(true)
  })

  it('allows extra subtypes via config', () => {
    const config = { ...baseConfig, allowedSubtypes: 'message_changed, channel_topic' }
    expect(
      evaluateSlackV2Match(messageEvent({ subtype: 'message_changed' }), config, SELF).pass
    ).toBe(true)
  })

  it('drops all bot messages by default', () => {
    const result = evaluateSlackV2Match(messageEvent({ bot_id: 'B_OTHER' }), baseConfig, SELF)
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('bot message')
  })

  it('allows other bots when ignoreBotMessages is off, but still drops self', () => {
    const config = { ...baseConfig, ignoreBotMessages: false }
    expect(
      evaluateSlackV2Match(messageEvent({ bot_id: 'B_OTHER', user: '' }), config, SELF).pass
    ).toBe(true)
    expect(
      evaluateSlackV2Match(messageEvent({ bot_id: 'B_SELF', user: '' }), config, SELF).pass
    ).toBe(false)
    expect(evaluateSlackV2Match(messageEvent({ user: 'U_SELF' }), config, SELF).pass).toBe(false)
    expect(
      evaluateSlackV2Match(messageEvent({ app_id: 'A_SELF', user: '' }), config, SELF).pass
    ).toBe(false)
  })

  it('drops own reactions but passes others', () => {
    const reaction = (user: string) => ({
      event: { type: 'reaction_added', user, reaction: 'eyes', item: { channel: 'C9', ts: '1.1' } },
    })
    expect(evaluateSlackV2Match(reaction('U_SELF'), baseConfig, SELF).pass).toBe(false)
    expect(evaluateSlackV2Match(reaction('U_HUMAN'), baseConfig, SELF).pass).toBe(true)
  })

  it('applies the channel filter to channel-scoped events only', () => {
    const config = { ...baseConfig, channelFilter: ['C999'] }
    expect(evaluateSlackV2Match(messageEvent(), config, SELF).pass).toBe(false)
    expect(evaluateSlackV2Match(messageEvent({ channel: 'C999' }), config, SELF).pass).toBe(true)
    // DMs unaffected by the channel filter.
    expect(
      evaluateSlackV2Match(messageEvent({ channel: 'D42', channel_type: 'im' }), config, SELF).pass
    ).toBe(true)
  })

  it('suppresses the message copy of a mention when both types are enabled', () => {
    const mentionCopy = messageEvent({ text: 'hey <@U_SELF> help me' })
    const result = evaluateSlackV2Match(mentionCopy, baseConfig, SELF)
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('app_mention')

    // The app_mention copy itself still fires.
    const appMention = messageEvent({ type: 'app_mention', text: 'hey <@U_SELF> help me' })
    expect(evaluateSlackV2Match(appMention, baseConfig, SELF).pass).toBe(true)

    // Opt-out restores raw delivery.
    const config = { ...baseConfig, skipMentionMessageCopies: false }
    expect(evaluateSlackV2Match(mentionCopy, config, SELF).pass).toBe(true)

    // Mentions of other users are not suppressed.
    expect(
      evaluateSlackV2Match(messageEvent({ text: 'hey <@U_OTHER> help' }), baseConfig, SELF).pass
    ).toBe(true)
  })

  it('filters slash commands against the configured table', () => {
    const config = {
      ...baseConfig,
      trigger_slash_command: true,
      slashCommands: [
        { id: 'r1', cells: { Command: '/elder', Description: 'Ask' } },
        { id: 'r2', cells: { Command: 'elder-todos', Description: 'Todos' } },
      ],
    }
    expect(evaluateSlackV2Match({ command: '/elder', channel_id: 'C1' }, config, SELF).pass).toBe(
      true
    )
    // Normalization: bare names in the table still match.
    expect(
      evaluateSlackV2Match({ command: '/elder-todos', channel_id: 'C1' }, config, SELF).pass
    ).toBe(true)
    expect(evaluateSlackV2Match({ command: '/other', channel_id: 'C1' }, config, SELF).pass).toBe(
      false
    )
  })

  it('passes assistant thread events when the capability is on', () => {
    const payload = {
      api_app_id: 'A_SELF',
      event: {
        type: 'assistant_thread_started',
        assistant_thread: { channel_id: 'D1', thread_ts: '1.2', user_id: 'U1' },
      },
    }
    expect(evaluateSlackV2Match(payload, baseConfig, SELF).pass).toBe(false)
    expect(
      evaluateSlackV2Match(payload, { ...baseConfig, trigger_assistant: true }, SELF).pass
    ).toBe(true)
  })

  it('drops unknown event types', () => {
    const result = evaluateSlackV2Match(
      { event: { type: 'channel_rename', channel: 'C1' } },
      baseConfig,
      SELF
    )
    expect(result.pass).toBe(false)
  })
})

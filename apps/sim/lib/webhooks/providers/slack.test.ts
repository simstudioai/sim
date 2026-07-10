import { describe, expect, it } from 'vitest'
import {
  resolveSlackEventKey,
  shouldSkipSlackTriggerEvent,
  slackHandler,
} from '@/lib/webhooks/providers/slack'

const ctx = (body: unknown) => ({
  webhook: {},
  workflow: { id: 'wf', userId: 'u' },
  body,
  headers: {},
  requestId: 'slack-test',
})

const eventOf = (input: unknown) =>
  (input as { event: Record<string, unknown> }).event as Record<string, unknown>

describe('slackHandler formatInput - Events API', () => {
  it('maps an app_mention event', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        team_id: 'T1',
        event_id: 'Ev1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: 'hey <@bot> hello',
          ts: '111.222',
          thread_ts: '111.000',
        },
      })
    )
    const event = eventOf(input)
    expect(event.event_type).toBe('app_mention')
    expect(event.channel).toBe('C1')
    expect(event.user).toBe('U1')
    expect(event.text).toBe('hey <@bot> hello')
    expect(event.timestamp).toBe('111.222')
    expect(event.thread_ts).toBe('111.000')
    expect(event.team_id).toBe('T1')
    expect(event.event_id).toBe('Ev1')
    // Interactivity-only fields stay empty for Events API payloads.
    expect(event.command).toBe('')
    expect(event.action_value).toBe('')
    expect(event.actions).toEqual([])
  })
})

describe('slackHandler formatInput - interactivity (block_actions)', () => {
  it('carries the button action value, channel, user, and response_url through', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        type: 'block_actions',
        api_app_id: 'A123',
        team: { id: 'T1', domain: 'acme' },
        user: { id: 'U1', username: 'alice' },
        channel: { id: 'C1', name: 'general' },
        trigger_id: 'trigger-1',
        response_url: 'https://hooks.slack.com/actions/abc',
        container: { message_ts: '999.000' },
        message: {
          ts: '999.000',
          text: 'Approve this?',
          thread_ts: '999.aaa',
          blocks: [{ type: 'section', block_id: 'b1', text: { type: 'mrkdwn', text: 'Approve?' } }],
        },
        state: { values: { reason_block: { reason_input: { value: 'looks good' } } } },
        actions: [
          {
            action_id: 'approve_btn',
            block_id: 'b1',
            value: 'approve_42',
            action_ts: '1234.5678',
          },
        ],
      })
    )
    const event = eventOf(input)
    expect(event.event_type).toBe('block_actions')
    expect(event.channel).toBe('C1')
    expect(event.channel_name).toBe('general')
    expect(event.user).toBe('U1')
    expect(event.user_name).toBe('alice')
    expect(event.team_id).toBe('T1')
    expect(event.action_id).toBe('approve_btn')
    expect(event.action_value).toBe('approve_42')
    expect(event.text).toBe('Approve this?')
    expect(event.message_ts).toBe('999.000')
    expect(event.timestamp).toBe('999.000')
    expect(event.thread_ts).toBe('999.aaa')
    expect(event.response_url).toBe('https://hooks.slack.com/actions/abc')
    expect(event.trigger_id).toBe('trigger-1')
    expect(event.api_app_id).toBe('A123')
    expect(Array.isArray(event.actions)).toBe(true)
    expect((event.actions as unknown[]).length).toBe(1)
    const message = event.message as Record<string, unknown>
    expect(message).not.toBeNull()
    expect(Array.isArray(message.blocks)).toBe(true)
    expect((message.blocks as unknown[]).length).toBe(1)
    expect(event.view).toBeNull()
    const state = event.state as { values: Record<string, Record<string, { value: string }>> }
    expect(state).not.toBeNull()
    expect(state.values.reason_block.reason_input.value).toBe('looks good')
  })

  it('carries the full view (state.values + private_metadata) through for a view_submission', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        type: 'view_submission',
        user: { id: 'U1', username: 'alice' },
        team: { id: 'T1' },
        trigger_id: 'trigger-2',
        view: {
          id: 'V123',
          callback_id: 'create_ticket',
          private_metadata: '{"thread_ts":"999.aaa"}',
          hash: 'abc.def',
          state: {
            values: {
              summary_block: { summary_input: { type: 'plain_text_input', value: 'Printer down' } },
            },
          },
        },
      })
    )
    const event = eventOf(input)
    expect(event.event_type).toBe('view_submission')
    expect(event.callback_id).toBe('create_ticket')
    const view = event.view as Record<string, unknown>
    expect(view).not.toBeNull()
    expect(view.private_metadata).toBe('{"thread_ts":"999.aaa"}')
    const values = (view.state as Record<string, unknown>).values as Record<
      string,
      Record<string, Record<string, unknown>>
    >
    expect(values.summary_block.summary_input.value).toBe('Printer down')
    expect(event.message).toBeNull()
    expect(event.state).toBeNull()
  })

  it('normalizes a static_select value and falls back to action value for text', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        type: 'block_actions',
        user: { id: 'U2', name: 'bob' },
        channel: { id: 'C9' },
        actions: [
          {
            action_id: 'pick',
            type: 'static_select',
            selected_option: { value: 'opt_b', text: { type: 'plain_text', text: 'Option B' } },
          },
        ],
      })
    )
    const event = eventOf(input)
    expect(event.action_value).toBe('opt_b')
    // No message text on the payload -> text falls back to the action value.
    expect(event.text).toBe('opt_b')
    expect(event.user_name).toBe('bob')
  })
})

describe('slackHandler formatInput - slash commands', () => {
  it('maps flat slash-command form fields', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        command: '/deploy',
        text: 'staging now',
        team_id: 'T1',
        channel_id: 'C1',
        channel_name: 'ops',
        user_id: 'U1',
        user_name: 'alice',
        api_app_id: 'A123',
        response_url: 'https://hooks.slack.com/commands/abc',
        trigger_id: 'trigger-2',
      })
    )
    const event = eventOf(input)
    expect(event.event_type).toBe('slash_command')
    expect(event.command).toBe('/deploy')
    expect(event.text).toBe('staging now')
    expect(event.channel).toBe('C1')
    expect(event.channel_name).toBe('ops')
    expect(event.user).toBe('U1')
    expect(event.user_name).toBe('alice')
    expect(event.team_id).toBe('T1')
    expect(event.response_url).toBe('https://hooks.slack.com/commands/abc')
    expect(event.trigger_id).toBe('trigger-2')
    expect(event.api_app_id).toBe('A123')
  })
})

describe('slackHandler extractIdempotencyId', () => {
  it('uses event_id for Events API payloads', () => {
    expect(slackHandler.extractIdempotencyId!({ event_id: 'Ev1' })).toBe('Ev1')
  })

  it('uses trigger_id for interactivity and slash-command payloads', () => {
    expect(
      slackHandler.extractIdempotencyId!({ type: 'block_actions', trigger_id: 'trigger-1' })
    ).toBe('trigger-1')
    expect(
      slackHandler.extractIdempotencyId!({ command: '/deploy', trigger_id: 'trigger-2' })
    ).toBe('trigger-2')
  })

  it('returns null when no identifier is present', () => {
    expect(slackHandler.extractIdempotencyId!({})).toBeNull()
  })
})

const API_APP_ID = 'A_SELF'

function slackBody(event: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { team_id: 'T1', api_app_id: API_APP_ID, event, ...extra }
}

/** True when the event fires (i.e. is not skipped) for the given config. */
function fires(config: Record<string, unknown>, event: Record<string, unknown>): boolean {
  return !shouldSkipSlackTriggerEvent(slackBody(event), config)
}

describe('shouldSkipSlackTriggerEvent', () => {
  it('fires a message event matching source=channel in a public channel', () => {
    expect(
      fires(
        { eventType: 'message', source: ['channel'] },
        {
          type: 'message',
          channel_type: 'channel',
          channel: 'C1',
          ts: '1.1',
        }
      )
    ).toBe(true)
  })

  it('drops a DM when source is restricted to public channels', () => {
    expect(
      fires(
        { eventType: 'message', source: ['channel'] },
        {
          type: 'message',
          channel_type: 'im',
          channel: 'D1',
          ts: '1.1',
        }
      )
    ).toBe(false)
  })

  it('source=[public,private] fires on both channel types but drops DMs', () => {
    const source = ['channel', 'group']
    expect(
      fires(
        { eventType: 'message', source },
        {
          type: 'message',
          channel_type: 'channel',
          channel: 'C1',
          ts: '1.2',
        }
      )
    ).toBe(true)
    expect(
      fires(
        { eventType: 'message', source },
        {
          type: 'message',
          channel_type: 'group',
          channel: 'G1',
          ts: '1.3',
        }
      )
    ).toBe(true)
    expect(
      fires(
        { eventType: 'message', source },
        {
          type: 'message',
          channel_type: 'im',
          channel: 'D1',
          ts: '1.4',
        }
      )
    ).toBe(false)
  })

  it('empty source matches any channel type', () => {
    expect(
      fires(
        { eventType: 'message', source: [] },
        {
          type: 'message',
          channel_type: 'im',
          channel: 'D1',
          ts: '1.5',
        }
      )
    ).toBe(true)
  })

  it('a channel filter never drops a DM allowed by Source', () => {
    const config = { eventType: 'message', source: ['im', 'channel'], channelFilter: ['C1'] }
    expect(fires(config, { type: 'message', channel_type: 'im', channel: 'D1', ts: '1.6' })).toBe(
      true
    )
    expect(
      fires(config, { type: 'message', channel_type: 'channel', channel: 'C1', ts: '1.7' })
    ).toBe(true)
    expect(
      fires(config, { type: 'message', channel_type: 'channel', channel: 'C2', ts: '1.8' })
    ).toBe(false)
  })

  it('app_mention Threads=Only fires only on threaded mentions', () => {
    expect(
      fires(
        { eventType: 'app_mention', threads: 'only' },
        {
          type: 'app_mention',
          channel: 'C1',
          ts: '2.0',
        }
      )
    ).toBe(false)
    expect(
      fires(
        { eventType: 'app_mention', threads: 'only' },
        {
          type: 'app_mention',
          channel: 'C1',
          ts: '2.1',
          thread_ts: '2.0',
        }
      )
    ).toBe(true)
  })

  it('maps message_changed to message_edited and not to message', () => {
    const edit = {
      type: 'message',
      subtype: 'message_changed',
      channel_type: 'channel',
      channel: 'C1',
      ts: '3.1',
    }
    expect(fires({ eventType: 'message_edited' }, edit)).toBe(true)
    expect(fires({ eventType: 'message' }, edit)).toBe(false)
  })

  it('does not drop an edit event that omits channel_type when a Source is selected', () => {
    // message_changed payloads often omit channel_type; a Source selection must
    // not silently swallow them.
    const edit = {
      type: 'message',
      subtype: 'message_changed',
      channel: 'C1',
      ts: '3.2',
    }
    expect(fires({ eventType: 'message_edited', source: ['channel'] }, edit)).toBe(true)
  })

  it("self-drops the app's own message unless includeOwnMessages is set", () => {
    const own = {
      type: 'message',
      channel_type: 'channel',
      channel: 'C1',
      ts: '4.1',
      app_id: API_APP_ID,
      bot_id: 'B1',
    }
    expect(fires({ eventType: 'message' }, own)).toBe(false)
    expect(fires({ eventType: 'message', includeOwnMessages: true }, own)).toBe(true)
  })

  it("self-drops the app's own reaction via stored bot_user_id", () => {
    const event = {
      type: 'reaction_added',
      reaction: 'thumbsup',
      user: 'U_BOT',
      item: { channel: 'C1', ts: '5.0' },
    }
    expect(fires({ eventType: 'reaction_added', bot_user_id: 'U_BOT' }, event)).toBe(false)
    expect(fires({ eventType: 'reaction_added', bot_user_id: 'U_OTHER' }, event)).toBe(true)
  })

  it('applies the emoji filter to reaction events', () => {
    const event = {
      type: 'reaction_added',
      reaction: 'eyes',
      user: 'U1',
      item: { channel: 'C1', ts: '6.0' },
    }
    expect(fires({ eventType: 'reaction_added', emoji: 'thumbsup' }, event)).toBe(false)
    expect(fires({ eventType: 'reaction_added', emoji: 'eyes, thumbsup' }, event)).toBe(true)
  })

  it('honors the legacy events array for pre-redesign webhooks', () => {
    expect(
      fires(
        { events: ['message.channels'] },
        {
          type: 'message',
          channel_type: 'channel',
          channel: 'C1',
          ts: '7.1',
        }
      )
    ).toBe(true)
  })

  it('ignores other bots unless filterBotMessages is off', () => {
    const otherBot = {
      type: 'message',
      channel_type: 'channel',
      channel: 'C1',
      ts: '8.1',
      bot_id: 'B_OTHER',
      app_id: 'A_OTHER',
    }
    expect(fires({ eventType: 'message' }, otherBot)).toBe(false)
    expect(fires({ eventType: 'message', filterBotMessages: false }, otherBot)).toBe(true)
  })
})

describe('resolveSlackEventKey - interactions', () => {
  it('maps a top-level block_actions / view_submission payload (no event envelope)', () => {
    expect(resolveSlackEventKey({ type: 'block_actions', actions: [] })).toBe('block_actions')
    expect(resolveSlackEventKey({ type: 'view_submission', view: {} })).toBe('view_submission')
  })

  it('does not surface unsupported interaction types or Events API without an event', () => {
    expect(resolveSlackEventKey({ type: 'shortcut' })).toBeNull()
    expect(resolveSlackEventKey({ type: 'view_closed' })).toBeNull()
    expect(resolveSlackEventKey({})).toBeNull()
  })
})

/** True when an interaction (top-level payload, no event envelope) fires. */
function interactionFires(config: Record<string, unknown>, body: Record<string, unknown>): boolean {
  return !shouldSkipSlackTriggerEvent(
    { team: { id: 'T1' }, api_app_id: API_APP_ID, ...body },
    config
  )
}

describe('shouldSkipSlackTriggerEvent - interactions', () => {
  const blockActions = {
    type: 'block_actions',
    user: { id: 'U1' },
    actions: [{ action_id: 'approve_btn', value: 'v' }],
  }
  const viewSubmission = {
    type: 'view_submission',
    user: { id: 'U1' },
    view: { callback_id: 'create_ticket' },
  }

  it('fires a block_actions event when eventType matches and no filter is set', () => {
    expect(interactionFires({ eventType: 'block_actions' }, blockActions)).toBe(true)
  })

  it('drops an interaction when the configured eventType is a different event', () => {
    expect(interactionFires({ eventType: 'message' }, blockActions)).toBe(false)
    expect(interactionFires({ eventType: 'view_submission' }, blockActions)).toBe(false)
  })

  it('scopes block_actions to matching action_ids', () => {
    expect(
      interactionFires({ eventType: 'block_actions', interactionFilter: 'deny_btn' }, blockActions)
    ).toBe(false)
    expect(
      interactionFires(
        { eventType: 'block_actions', interactionFilter: 'approve_btn, deny_btn' },
        blockActions
      )
    ).toBe(true)
  })

  it('scopes view_submission to matching callback_ids', () => {
    expect(
      interactionFires(
        { eventType: 'view_submission', interactionFilter: 'other_modal' },
        viewSubmission
      )
    ).toBe(false)
    expect(
      interactionFires(
        { eventType: 'view_submission', interactionFilter: 'create_ticket' },
        viewSubmission
      )
    ).toBe(true)
  })
})

describe('slackHandler.shouldSkipEvent (custom-app path)', () => {
  const message = slackBody({ type: 'message', channel_type: 'channel', channel: 'C1', ts: '9.1' })
  const skipCtx = (providerConfig: Record<string, unknown>, body: unknown) => ({
    webhook: {},
    body,
    requestId: 'r',
    providerConfig,
  })

  it('applies the trigger filter for a slack_oauth webhook', () => {
    // Configured for reactions, but a message arrives -> skip.
    expect(
      slackHandler.shouldSkipEvent!(
        skipCtx({ triggerId: 'slack_oauth', eventType: 'reaction_added' }, message)
      )
    ).toBe(true)
    // Configured for messages -> fire.
    expect(
      slackHandler.shouldSkipEvent!(
        skipCtx({ triggerId: 'slack_oauth', eventType: 'message' }, message)
      )
    ).toBe(false)
  })

  it('never skips the legacy slack_webhook trigger (unfiltered)', () => {
    expect(
      slackHandler.shouldSkipEvent!(
        skipCtx({ triggerId: 'slack_webhook', eventType: 'reaction_added' }, message)
      )
    ).toBe(false)
    expect(slackHandler.shouldSkipEvent!(skipCtx({}, message))).toBe(false)
  })
})

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  handleSlackChallenge,
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

describe('slackHandler responses', () => {
  it('returns a retryable failure when queue admission fails', () => {
    expect(slackHandler.formatQueueErrorResponse!().status).toBe(500)
  })
})

describe('slackHandler request verification', () => {
  const rawBody = JSON.stringify({ type: 'event_callback' })

  function signedRequest(signingSecret: string, timestamp: string, body = rawBody): Request {
    const signature = createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${body}`, 'utf8')
      .digest('hex')
    return new Request('https://sim.test/api/webhooks/trigger/slack', {
      method: 'POST',
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': `v0=${signature}`,
      },
    })
  }

  function verify(request: Request, providerConfig: Record<string, unknown>, body = rawBody) {
    return slackHandler.verifyAuth!({
      webhook: {},
      workflow: {},
      request: request as unknown as import('next/server').NextRequest,
      rawBody: body,
      requestId: 'slack-auth-test',
      providerConfig,
    })
  }

  it('fails closed when a legacy Slack webhook has no signing secret', async () => {
    const response = await verify(new Request('https://sim.test'), {})

    expect(response?.status).toBe(401)
  })

  it('accepts a correctly signed current request', async () => {
    const signingSecret = 'test-signing-secret'
    const timestamp = String(Math.floor(Date.now() / 1000))

    expect(verify(signedRequest(signingSecret, timestamp), { signingSecret })).toBeNull()
  })

  it('rejects a signature computed for different raw bytes', async () => {
    const signingSecret = 'test-signing-secret'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const request = signedRequest(signingSecret, timestamp)

    const response = await verify(request, { signingSecret }, `${rawBody} `)

    expect(response?.status).toBe(401)
  })

  it("rejects an otherwise valid signature outside Slack's five-minute replay window", async () => {
    const signingSecret = 'test-signing-secret'
    const timestamp = String(Math.floor(Date.now() / 1000) - 301)

    const response = await verify(signedRequest(signingSecret, timestamp), { signingSecret })

    expect(response?.status).toBe(401)
  })
})

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
    expect(event.command).toBe('')
    expect(event.action_value).toBe('')
    expect(event.actions).toEqual([])
  })

  it('maps an agent_session_stopped event', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        team_id: 'T1',
        event_id: 'Ev2',
        event: {
          type: 'agent_session_stopped',
          channel: 'D1',
          user: 'U1',
          thread_ts: '111.000',
          event_ts: '112.000',
          streaming_message_ts: ['111.001', '111.002'],
        },
      })
    )
    expect(eventOf(input)).toMatchObject({
      event_type: 'agent_session_stopped',
      channel: 'D1',
      user: 'U1',
      thread_ts: '111.000',
      timestamp: '112.000',
      streaming_message_ts: ['111.001', '111.002'],
      team_id: 'T1',
    })
  })

  it('maps the nested assistant_thread_started reply target', async () => {
    const { input } = await slackHandler.formatInput!(
      ctx({
        team_id: 'T-install',
        event: {
          type: 'assistant_thread_started',
          assistant_thread: {
            channel_id: 'C1',
            user_id: 'U1',
            thread_ts: '111.000',
            context: { team_id: 'T-user' },
          },
        },
      })
    )
    expect(eventOf(input)).toMatchObject({
      event_type: 'assistant_thread_started',
      channel: 'C1',
      user: 'U1',
      thread_ts: '111.000',
      team_id: 'T-install',
      user_team_id: 'T-user',
    })
  })

  it('maps an agent_session_title_changed event and the Agent View tab', async () => {
    const titleChanged = await slackHandler.formatInput!(
      ctx({
        event: {
          type: 'agent_session_title_changed',
          channel: 'D1',
          user: 'U1',
          thread_ts: '111.000',
          event_ts: '112.000',
          team_id: 'T1',
          enterprise_id: 'E1',
          title: 'New title',
          previous_title: 'Old title',
        },
      })
    )
    expect(eventOf(titleChanged.input)).toMatchObject({
      event_type: 'agent_session_title_changed',
      title: 'New title',
      previous_title: 'Old title',
      team_id: 'T1',
      enterprise_id: 'E1',
    })

    const appHome = await slackHandler.formatInput!(
      ctx({ event: { type: 'app_home_opened', user: 'U1', tab: 'messages' } })
    )
    expect(eventOf(appHome.input).tab).toBe('messages')
  })

  it('maps app_context_changed and normalizes message.im app_context', async () => {
    const contextChanged = await slackHandler.formatInput!(
      ctx({
        event: {
          type: 'app_context_changed',
          user: 'U1',
          context: {
            entities: [{ type: 'slack#/types/channel_id', value: 'C1', team_id: 'T1' }],
          },
        },
      })
    )
    expect(eventOf(contextChanged.input)).toMatchObject({
      event_type: 'app_context_changed',
      context: {
        entities: [{ type: 'slack#/types/channel_id', value: 'C1', team_id: 'T1' }],
      },
    })
    expect(resolveSlackEventKey({ event: { type: 'app_context_changed', context: {} } })).toBe(
      'app_context_changed'
    )

    const directMessage = await slackHandler.formatInput!(
      ctx({
        event: {
          type: 'message',
          channel: 'D1',
          channel_type: 'im',
          app_context: { entities: [] },
        },
      })
    )
    expect(eventOf(directMessage.input).context).toEqual({ entities: [] })
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
    expect(event.text).toBe('opt_b')
    expect(event.user_name).toBe('bob')
  })
})

describe('slackHandler formatInput - block_suggestion', () => {
  it('skips execution instead of triggering the workflow', async () => {
    const { input, skip } = await slackHandler.formatInput!(
      ctx({
        type: 'block_suggestion',
        action_id: 'external_select',
        block_id: 'b1',
        value: 'sea',
        team: { id: 'T1' },
        user: { id: 'U1' },
      })
    )
    expect(input).toBeNull()
    expect(skip?.message).toBeTruthy()
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

  it('degrades gracefully instead of throwing for a null or non-object body', () => {
    expect(slackHandler.extractIdempotencyId!(null)).toBeNull()
    expect(slackHandler.extractIdempotencyId!(undefined)).toBeNull()
    expect(slackHandler.extractIdempotencyId!('not-an-object')).toBeNull()
  })
})

describe('handleSlackChallenge', () => {
  it('echoes the challenge for a url_verification payload', () => {
    const response = handleSlackChallenge({ type: 'url_verification', challenge: 'abc123' })
    expect(response).not.toBeNull()
  })

  it('returns null for non-challenge payloads', () => {
    expect(handleSlackChallenge({ type: 'event_callback' })).toBeNull()
  })

  it('degrades gracefully instead of throwing for a null or non-object body', () => {
    expect(handleSlackChallenge(null)).toBeNull()
    expect(handleSlackChallenge(undefined)).toBeNull()
    expect(handleSlackChallenge('not-an-object')).toBeNull()
    expect(handleSlackChallenge([1, 2, 3])).toBeNull()
  })
})

describe('slackHandler formatInput - null/non-object body', () => {
  it('degrades gracefully instead of throwing', async () => {
    const { input } = await slackHandler.formatInput!(ctx(null))
    const event = eventOf(input)
    expect(event.event_type).toBe('unknown')
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

  it('matches the channel filter for object-form channels (channel_rename)', () => {
    // channel_created / channel_rename deliver `channel` as an object, not a string.
    const rename = {
      type: 'channel_rename',
      channel: { id: 'C1', name: 'renamed-channel', created: 1 },
    }
    expect(fires({ eventType: 'channel_rename', channelFilter: ['C1'] }, rename)).toBe(true)
    expect(fires({ eventType: 'channel_rename', channelFilter: ['C2'] }, rename)).toBe(false)
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

  it('fails closed when no eventType and the legacy events selection is empty or missing', () => {
    const event = { type: 'message', channel_type: 'channel', channel: 'C1', ts: '7.0' }
    expect(fires({}, event)).toBe(false)
    expect(fires({ events: [] }, event)).toBe(false)
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

describe('shouldSkipSlackTriggerEvent - slash commands', () => {
  const slashCommand = {
    command: '/ask-sim',
    text: 'Summarize this channel',
    team_id: 'T1',
    channel_id: 'C1',
    user_id: 'U1',
  }

  it('maps slash command payloads to the selectable trigger event', () => {
    expect(resolveSlackEventKey(slashCommand)).toBe('slash_command')
  })

  it('fires for any command when no command filter is set', () => {
    expect(shouldSkipSlackTriggerEvent(slashCommand, { eventType: 'slash_command' })).toBe(false)
  })

  it('matches the exact configured command', () => {
    expect(
      shouldSkipSlackTriggerEvent(slashCommand, {
        eventType: 'slash_command',
        commandFilter: '/ask-sim',
      })
    ).toBe(false)
    expect(
      shouldSkipSlackTriggerEvent(slashCommand, {
        eventType: 'slash_command',
        commandFilter: '/deploy',
      })
    ).toBe(true)
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

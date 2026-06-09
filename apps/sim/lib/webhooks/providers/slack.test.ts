import { describe, expect, it } from 'vitest'
import { slackHandler } from '@/lib/webhooks/providers/slack'

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
        message: { ts: '999.000', text: 'Approve this?', thread_ts: '999.aaa' },
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

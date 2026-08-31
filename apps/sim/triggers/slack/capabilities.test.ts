import { describe, expect, it } from 'vitest'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
} from '@/triggers/slack/capabilities'

const opts = { appName: 'Test Bot', webhookUrl: 'https://sim.test/api/webhooks/slack' }

const REQUIRED_AGENT_SCOPES = [
  'assistant:write',
  'chat:write',
  'chat:write.customize',
  'im:history',
  'im:write',
]

const REQUIRED_AGENT_EVENTS = [
  'agent_session_stopped',
  'agent_session_title_changed',
  'app_context_changed',
  'app_home_opened',
  'assistant_thread_context_changed',
  'assistant_thread_started',
  'message.im',
]

function settingsOf(manifest: Record<string, unknown>) {
  return manifest.settings as Record<string, unknown>
}

describe('buildSlackManifest - interactivity', () => {
  it('emits settings.interactivity when the interactivity capability is active', () => {
    const manifest = buildSlackManifest(new Set(['action_interactivity']), opts)
    expect(settingsOf(manifest).interactivity).toEqual({
      is_enabled: true,
      request_url: opts.webhookUrl,
    })
  })

  it('omits settings.interactivity when the capability is absent', () => {
    const manifest = buildSlackManifest(new Set(), opts)
    expect(settingsOf(manifest).interactivity).toBeUndefined()
  })

  it('keeps mandatory Agent View event subscriptions without interactivity', () => {
    const manifest = buildSlackManifest(new Set(), opts)
    expect(settingsOf(manifest).event_subscriptions).toEqual({
      request_url: opts.webhookUrl,
      bot_events: REQUIRED_AGENT_EVENTS,
    })
  })
})

describe('buildSlackManifest - Agent View', () => {
  it('enables Agent View, Agent Sessions, streaming, and direct messages for every custom bot', () => {
    const manifest = buildSlackManifest(new Set(), opts)
    const features = manifest.features as Record<string, Record<string, unknown>>

    expect(SLACK_CAPABILITIES.map((capability) => capability.id)).not.toEqual(
      expect.arrayContaining(['action_assistant', 'action_send', 'trigger_app_home'])
    )
    expect(features.agent_view).toEqual({
      agent_description: 'Test Bot — an AI agent powered by Sim.',
    })
    expect(features.app_home).toEqual({
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    })
    expect(manifest.oauth_config).toEqual({ scopes: { bot: REQUIRED_AGENT_SCOPES } })
    expect(settingsOf(manifest).event_subscriptions).toEqual({
      request_url: opts.webhookUrl,
      bot_events: REQUIRED_AGENT_EVENTS,
    })
  })

  it('emits a custom description, actions, and suggested prompts', () => {
    const manifest = buildSlackManifest(new Set(), {
      ...opts,
      description: ' Answers support questions. ',
      agentActions: [{ name: ' Search docs ', description: ' Find answers in the support docs. ' }],
      suggestedPrompts: [{ title: ' Reset password ', message: ' Help me reset my password. ' }],
    })
    expect(manifest.display_information).toEqual({
      name: 'Test Bot',
      description: 'Answers support questions.',
    })
    const features = manifest.features as Record<string, Record<string, unknown>>
    expect(features.agent_view).toEqual({
      agent_description: 'Answers support questions.',
      actions: [{ name: 'Search docs', description: 'Find answers in the support docs.' }],
      suggested_prompts: [{ title: 'Reset password', message: 'Help me reset my password.' }],
    })
  })

  it('fails fast for incomplete agent actions or suggested prompts', () => {
    expect(() =>
      buildSlackManifest(new Set(), {
        ...opts,
        agentActions: [{ name: 'Search docs', description: ' ' }],
      })
    ).toThrow('Slack agent action 1 requires a name and description')

    expect(() =>
      buildSlackManifest(new Set(), {
        ...opts,
        suggestedPrompts: [{ title: ' ', message: 'Find a document' }],
      })
    ).toThrow('Slack suggested prompt 1 requires a title and message')
  })

  it("fails fast when the Agent View description exceeds Slack's limit", () => {
    expect(() => buildSlackManifest(new Set(), { ...opts, description: 'a'.repeat(301) })).toThrow(
      'Slack agent description must be 300 characters or fewer'
    )
  })
})

describe('buildSlackManifest - managed users', () => {
  it('defines managed user authorization as enabled by default', () => {
    expect(SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY).toMatchObject({
      id: 'managed_user_authorization',
      defaultChecked: true,
    })
  })

  it('adds user OAuth configuration and its bot prerequisite', () => {
    const managedUserAuthorization =
      getSlackManagedUserAuthorizationManifestConfig('https://sim.ai')
    const manifest = buildSlackManifest(new Set(), {
      appName: 'Managed Slack',
      webhookUrl: 'https://sim.ai/api/webhooks/slack/custom/credential-id',
      managedUserAuthorization,
    })

    expect(manifest).toMatchObject({
      oauth_config: {
        redirect_urls: [
          'https://sim.ai/api/credential-groups/slack-managed-users/callback',
          'https://sim.ai/api/credential-groups/oauth/slack/callback',
        ],
        scopes: {
          bot: [...REQUIRED_AGENT_SCOPES, 'users:read'].sort(),
          user: [...SLACK_MANAGED_USER_SCOPES].sort(),
        },
      },
    })
  })

  it('omits managed user OAuth configuration when disabled', () => {
    const manifest = buildSlackManifest(new Set(), opts)
    expect(manifest.oauth_config).toEqual({ scopes: { bot: REQUIRED_AGENT_SCOPES } })
  })
})

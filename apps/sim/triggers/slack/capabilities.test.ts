import { describe, expect, it } from 'vitest'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
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

  it('keeps mandatory Agent View event subscriptions without interactivity', () => {
    const manifest = buildSlackManifest(new Set(), opts)
    expect(settingsOf(manifest).event_subscriptions).toEqual({
      request_url: opts.webhookUrl,
      bot_events: REQUIRED_AGENT_EVENTS,
    })
  })
})

describe('buildSlackManifest - Agent View', () => {
  it.each([
    { name: 'minimal', capabilities: new Set<string>() },
    { name: 'all capabilities', capabilities: new Set(SLACK_CAPABILITIES.map(({ id }) => id)) },
  ])('excludes incompatible Assistant events from $name manifests', ({ capabilities }) => {
    const manifest = buildSlackManifest(capabilities, opts)
    const features = manifest.features as Record<string, unknown>
    const subscriptions = settingsOf(manifest).event_subscriptions as { bot_events: string[] }

    expect(features.agent_view).toBeDefined()
    expect(features.assistant_view).toBeUndefined()
    expect(subscriptions.bot_events).not.toContain('assistant_thread_started')
    expect(subscriptions.bot_events).not.toContain('assistant_thread_context_changed')
    expect(subscriptions.bot_events).toEqual(
      expect.arrayContaining([
        'app_home_opened',
        'app_context_changed',
        'message.im',
        'agent_session_stopped',
        'agent_session_title_changed',
      ])
    )
  })

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

  it('fails fast for invalid slash commands', () => {
    expect(() =>
      buildSlackManifest(new Set(), {
        ...opts,
        slashCommands: [{ command: '/ask-support', description: ' ' }],
      })
    ).toThrow('Slack slash command 1 requires a command and description')

    expect(() =>
      buildSlackManifest(new Set(), {
        ...opts,
        slashCommands: [{ command: '/ask support', description: 'Ask support' }],
      })
    ).toThrow('Slack slash command 1 must be one word beginning with /')

    expect(() =>
      buildSlackManifest(new Set(), {
        ...opts,
        slashCommands: [
          { command: '/ask', description: 'Ask once' },
          { command: ' /ask ', description: 'Ask twice' },
        ],
      })
    ).toThrow('Slack slash command /ask is configured more than once')
  })

  it("fails fast when the Agent View description exceeds Slack's limit", () => {
    expect(() => buildSlackManifest(new Set(), { ...opts, description: 'a'.repeat(301) })).toThrow(
      'Slack agent description must be 300 characters or fewer'
    )
  })
})

describe('buildSlackManifest - managed users', () => {
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

  it('generates exactly the search user scope policy when selected', () => {
    const manifest = buildSlackManifest(new Set(), {
      ...opts,
      managedUserAuthorization: getSlackManagedUserAuthorizationManifestConfig(
        'https://sim.ai',
        SLACK_SEARCH_USER_SCOPES
      ),
    })
    expect(manifest).toMatchObject({
      oauth_config: { scopes: { user: [...SLACK_SEARCH_USER_SCOPES].sort() } },
    })
  })
})

import { describe, expect, it } from 'vitest'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
} from '@/triggers/slack/capabilities'

const opts = { appName: 'Test Bot', webhookUrl: 'https://sim.test/api/webhooks/slack' }

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
    const manifest = buildSlackManifest(new Set(['action_send']), opts)
    expect(settingsOf(manifest).interactivity).toBeUndefined()
  })

  it('enables interactivity independently of event subscriptions', () => {
    // No bot_events (interactivity-only bot) still gets the interactivity block.
    const manifest = buildSlackManifest(new Set(['action_interactivity']), opts)
    const settings = settingsOf(manifest)
    expect(settings.event_subscriptions).toBeUndefined()
    expect(settings.interactivity).toBeDefined()
  })
})

describe('buildSlackManifest - description', () => {
  it('emits display_information.description and reuses it as the assistant description', () => {
    const manifest = buildSlackManifest(new Set(['action_assistant']), {
      ...opts,
      description: 'Answers support questions.',
    })
    expect(manifest.display_information).toEqual({
      name: 'Test Bot',
      description: 'Answers support questions.',
    })
    const features = manifest.features as Record<string, Record<string, unknown>>
    expect(features.assistant_view.assistant_description).toBe('Answers support questions.')
  })

  it('omits the description key and falls back for the assistant when absent', () => {
    const manifest = buildSlackManifest(new Set(['action_assistant']), opts)
    expect(manifest.display_information).toEqual({ name: 'Test Bot' })
    const features = manifest.features as Record<string, Record<string, unknown>>
    expect(features.assistant_view.assistant_description).toBe(
      'Test Bot — an AI assistant powered by Sim.'
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
    const manifest = buildSlackManifest(new Set(['action_send']), {
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
          bot: ['chat:write', 'users:read'],
          user: [...SLACK_MANAGED_USER_SCOPES].sort(),
        },
      },
    })
  })

  it('omits managed user OAuth configuration when disabled', () => {
    const manifest = buildSlackManifest(new Set(['action_send']), opts)
    expect(manifest.oauth_config).toEqual({ scopes: { bot: ['chat:write'] } })
  })
})

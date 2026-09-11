/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createSharedSlackSearchManifest,
  createSlackSearchManifest,
} from '@/lib/slack-search/manifest'

describe('Search app manifest', () => {
  it('combines bot conversations and member indexing in one app with separate grants', () => {
    const manifest = createSlackSearchManifest('Sim Search', 'Search', 'https://sim.test')
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        'users:read',
        'users:read.email',
        'app_mentions:read',
        'im:write',
        'im:history',
      ])
    )
    expect(manifest.oauth_config.scopes.bot).not.toContain('groups:history')
    expect(manifest.oauth_config.scopes.user).toEqual(
      expect.arrayContaining([
        'users:read',
        'users:read.email',
        'channels:history',
        'groups:history',
        'im:history',
        'mpim:history',
        'im:read',
        'mpim:read',
      ])
    )
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining([
        'app_home_opened',
        'message.im',
        'app_mention',
        'agent_session_stopped',
      ])
    )
    expect(manifest.settings.event_subscriptions.bot_events).not.toContain('message.channels')
    expect(manifest.features.app_home.messages_tab_read_only_enabled).toBe(false)
    expect(manifest.features.app_home.home_tab_enabled).toBe(true)
    expect(manifest.oauth_config.redirect_urls).toHaveLength(3)
    expect(
      manifest.oauth_config.redirect_urls.every((url) => new URL(url).origin === 'https://sim.test')
    ).toBe(true)
  })
  it('preserves existing member grants when updating a bot manifest', () => {
    expect(
      createSlackSearchManifest('Sim Search', 'Search', 'https://sim.test', ['files:read'])
        .oauth_config.scopes.user
    ).toContain('files:read')
  })
  it('uses one origin for unified ingress and OAuth with only the required bot permissions', () => {
    const manifest = createSlackSearchManifest(
      'Sim Search',
      'Search with sources',
      'https://search-test.ngrok.app'
    )
    expect(manifest.oauth_config.scopes.bot).toEqual([
      'assistant:write',
      'chat:write',
      'im:history',
      'im:write',
      'app_mentions:read',
      'users:read',
      'users:read.email',
    ])
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      'https://search-test.ngrok.app/api/webhooks/slack'
    )
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      'app_home_opened',
      'message.im',
      'app_mention',
      'agent_session_stopped',
    ])
    expect(manifest.oauth_config.redirect_urls).toEqual([
      'https://search-test.ngrok.app/api/knowledge/slack/oauth/callback',
      'https://search-test.ngrok.app/api/credential-groups/slack-managed-users/callback',
      'https://search-test.ngrok.app/api/credential-groups/oauth/slack/callback',
    ])
    expect(manifest.features.agent_view).toEqual({ agent_description: 'Search with sources' })
    expect(manifest.display_information.name).toBe('Sim Search')
  })
  it('requires HTTPS before directing the admin to Slack', () => {
    expect(() =>
      createSlackSearchManifest('Sim Search', 'Search', 'http://localhost:3003')
    ).toThrow(OrchestrationError)
  })
})

it('official app declares expanded permissions without subscribing to member message events', () => {
  const manifest = createSharedSlackSearchManifest('https://www.sim.ai')
  expect(manifest.oauth_config.scopes.user).toEqual([
    'channels:history',
    'channels:read',
    'groups:history',
    'groups:read',
    'im:history',
    'im:read',
    'mpim:history',
    'mpim:read',
    'users:read',
    'users:read.email',
    'canvases:read',
    'canvases:write',
    'chat:write',
    'files:read',
    'search:read.files',
    'search:read.im',
    'search:read.mpim',
    'search:read.private',
    'search:read.public',
    'search:read.users',
    'team:read',
    'usergroups:read',
  ])
  expect(manifest.oauth_config.scopes.bot).toEqual([
    'assistant:write',
    'chat:write',
    'im:history',
    'im:write',
    'app_mentions:read',
    'users:read',
    'users:read.email',
    'commands',
    'channels:history',
    'channels:manage',
    'channels:read',
    'channels:write.invites',
    'chat:write.public',
    'groups:history',
    'groups:read',
    'groups:write',
    'groups:write.invites',
    'links:read',
    'links:write',
    'mpim:history',
    'mpim:read',
    'mpim:write',
    'reactions:write',
  ])
  expect(manifest.features.slash_commands.map((command) => command.command)).toEqual([
    '/query',
    '/connect',
  ])
  expect(
    manifest.features.slash_commands.every(
      (command) => command.url === 'https://www.sim.ai/api/webhooks/slack'
    )
  ).toBe(true)
  expect(manifest.settings.event_subscriptions.bot_events).toContain('tokens_revoked')
  expect(manifest.settings.event_subscriptions.bot_events).not.toContain('message.channels')
  expect(manifest.settings.event_subscriptions).not.toHaveProperty('user_events')
})

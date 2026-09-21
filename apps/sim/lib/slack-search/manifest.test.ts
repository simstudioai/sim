/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
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
        'channels:read',
        'groups:read',
      ])
    )
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
    const manifest = createSlackSearchManifest('Sim Search', 'Search', 'https://sim.test', [
      'files:read',
      'files:write',
    ])
    expect(manifest.oauth_config.scopes.user).toContain('files:write')
    expect(manifest.oauth_config.scopes.user.filter((scope) => scope === 'files:read')).toEqual([
      'files:read',
    ])
  })
  it('uses one origin for unified ingress and OAuth', () => {
    const manifest = createSlackSearchManifest(
      'Sim Search',
      'Search with sources',
      'https://search-test.ngrok.app'
    )
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
  it('uses the configured origin without blocking local setup', () => {
    const manifest = createSlackSearchManifest('Sim Search', 'Search', 'http://localhost:3000')
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      'http://localhost:3000/api/webhooks/slack'
    )
  })
})

it.each([
  {
    name: 'custom',
    manifest: createSlackSearchManifest('Sim Search', 'Search', 'https://sim.test'),
  },
  { name: 'shared', manifest: createSharedSlackSearchManifest('https://sim.test') },
])('$name app declares the complete bot and user scope sets without duplicates', ({ manifest }) => {
  expect([...manifest.oauth_config.scopes.user].sort()).toEqual([
    'canvases:read',
    'canvases:write',
    'channels:history',
    'channels:read',
    'chat:write',
    'files:read',
    'groups:history',
    'groups:read',
    'im:history',
    'im:read',
    'mpim:history',
    'mpim:read',
    'search:read.files',
    'search:read.im',
    'search:read.mpim',
    'search:read.private',
    'search:read.public',
    'search:read.users',
    'team:read',
    'usergroups:read',
    'users:read',
    'users:read.email',
  ])
  expect([...manifest.oauth_config.scopes.bot].sort()).toEqual([
    'app_mentions:read',
    'assistant:write',
    'channels:history',
    'channels:manage',
    'channels:read',
    'channels:write.invites',
    'chat:write',
    'chat:write.public',
    'commands',
    'groups:history',
    'groups:read',
    'groups:write',
    'groups:write.invites',
    'im:history',
    'im:write',
    'links:read',
    'links:write',
    'mpim:history',
    'mpim:read',
    'mpim:write',
    'reactions:write',
    'users:read',
    'users:read.email',
  ])
})

it('official app declares commands and lifecycle events without member message events', () => {
  const manifest = createSharedSlackSearchManifest('https://www.sim.ai')
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

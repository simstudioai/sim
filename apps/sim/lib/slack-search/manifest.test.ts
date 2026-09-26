import { describe, expect, it } from 'vitest'
import {
  createSharedSlackSearchManifest,
  createSlackSearchManifest,
} from '@/lib/slack-search/manifest'

describe('Search app manifest', () => {
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

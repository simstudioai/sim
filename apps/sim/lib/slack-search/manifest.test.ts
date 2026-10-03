import { describe, expect, it } from 'vitest'
import { createSlackSearchManifest } from '@/lib/slack-search/manifest'

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

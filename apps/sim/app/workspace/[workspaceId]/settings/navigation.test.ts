import { describe, expect, it } from 'vitest'
import { allNavigationItems } from '@/app/workspace/[workspaceId]/settings/navigation'

describe('resolveSettingsSection', () => {
  const LEGACY_SEGMENTS = {
    subscription: 'billing',
    team: 'organization',
    'api-keys': 'apikeys',
    domains: 'sso',
    sessions: 'security',
  } as const

  it('never shadows a real section with an alias', () => {
    // The day someone adds a section whose id collides with an alias key, that section becomes
    // unreachable — the alias would rewrite the segment before the catalog is consulted.
    for (const segment of Object.keys(LEGACY_SEGMENTS)) {
      expect(allNavigationItems.some((item) => item.id === segment)).toBe(false)
    }
  })
})

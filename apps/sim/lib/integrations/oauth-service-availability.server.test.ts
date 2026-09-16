/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: {
    GITHUB_APP_CLIENT_ID: 'repository-client',
    GITHUB_APP_CLIENT_SECRET: 'repository-secret',
  },
}))

import {
  getIntegrationAvailability,
  getOAuthServiceAvailability,
} from '@/lib/integrations/availability.server'

describe('OAuth service availability projection', () => {
  it('uses the repository App while the workflow block keeps its API-key path', () => {
    expect(
      getOAuthServiceAvailability([{ providerId: 'github-repositories', authType: 'oauth' }])
    ).toEqual([{ providerId: 'github-repositories', available: true }])
    expect(getIntegrationAvailability().find((item) => item.type === 'github_v2')).toMatchObject({
      state: 'ready',
      oauthAvailable: false,
    })
  })

  it('resolves canonical Google provider aliases and excludes service accounts', () => {
    expect(
      getOAuthServiceAvailability([
        { providerId: 'google-email', authType: 'oauth' },
        { providerId: 'google-calendar', authType: 'oauth' },
        { providerId: 'google-service-account', authType: 'service_account' },
      ])
    ).toEqual([
      { providerId: 'google-email', available: false },
      { providerId: 'google-calendar', available: false },
    ])
  })

  it('does not expose deployment fields or credentials', () => {
    const result = getOAuthServiceAvailability([
      { providerId: 'github-repositories', authType: 'oauth' },
    ])
    expect(Object.keys(result[0]).sort()).toEqual(['available', 'providerId'])
    expect(JSON.stringify(result)).not.toContain('repository-secret')
    expect(JSON.stringify(result)).not.toContain('GITHUB_APP')
  })
})

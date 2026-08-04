import { describe, expect, it } from 'vitest'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'

describe('intersectIntegrationAllowlists', () => {
  it('uses the configured list when the other policy is unrestricted', () => {
    expect(intersectIntegrationAllowlists(null, ['Slack'])).toEqual(['slack'])
    expect(intersectIntegrationAllowlists(['Notion'], null)).toEqual(['notion'])
    expect(intersectIntegrationAllowlists(null, null)).toBeNull()
  })

  it('keeps only integrations allowed by both policies', () => {
    expect(intersectIntegrationAllowlists(['Slack', 'Notion'], ['notion', 'gmail'])).toEqual([
      'notion',
    ])
  })

  it('preserves an explicit deny-all list', () => {
    expect(intersectIntegrationAllowlists([], null)).toEqual([])
    expect(intersectIntegrationAllowlists(['slack'], [])).toEqual([])
  })
})

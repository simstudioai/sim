/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  organizationSearchSetupPath,
  slackSearchSetupHref,
} from '@/lib/sim-search/setup-navigation'

describe('organization source setup', () => {
  it('opens organization integrations settings', () => {
    expect(organizationSearchSetupPath('org-1')).toBe('/o/org-1/settings/integrations')
  })
  it.each(['slack', 'search'] as const)(
    'preserves the %s continuation through Slack account setup',
    (source) => {
      expect(slackSearchSetupHref('org-1', source)).toBe(
        `/o/org-1/settings/integrations?search-setup=${source}&connectedAccounts=slack`
      )
    }
  )
})

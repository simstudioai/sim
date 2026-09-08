/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { searchSetupReturnHref, slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'

describe('source setup detours', () => {
  it('keeps organization Slack setup and its continuation in the same organization', () => {
    const scope = { kind: 'organization' as const, organizationId: 'org-1' }
    expect(slackSearchSetupHref(scope, 'slack')).toBe(
      '/o/org-1/settings/integrations?search-setup=slack&connectedAccounts=slack'
    )
    expect(searchSetupReturnHref(scope, 'slack')).toBe(
      '/o/org-1/settings/integrations?addConnector=slack'
    )
    expect(searchSetupReturnHref(scope, 'search')).toBe('/o/org-1/settings/integrations')
  })
  it('preserves workspace continuation links', () => {
    expect(searchSetupReturnHref('workspace-1', 'google_drive')).toBe(
      '/workspace/workspace-1/search?addConnector=google_drive'
    )
    expect(slackSearchSetupHref('workspace-1', 'slack')).toContain(
      '/workspace/workspace-1/settings/credential-groups?search-setup=slack&'
    )
  })
})

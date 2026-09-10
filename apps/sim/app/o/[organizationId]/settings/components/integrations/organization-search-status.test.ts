/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'
import { organizationSearchStatusLabel } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-status'

const provider: OrganizationSearchProviderSummary = {
  connectorType: 'gmail',
  approved: true,
  sourceCount: 0,
  status: 'waiting_for_connections',
  issue: null,
  isSyncing: false,
}

describe('organization source status labels', () => {
  it('describes the next step instead of calling all empty integrations unconfigured', () => {
    expect(organizationSearchStatusLabel(provider)).toBe('Waiting for connections')
    expect(organizationSearchStatusLabel({ ...provider, status: 'needs_setup' })).toBe(
      'Source not configured'
    )
    expect(
      organizationSearchStatusLabel({ ...provider, status: 'needs_setup', sourceCount: 1 })
    ).toBe('Waiting for first sync')
    expect(organizationSearchStatusLabel({ ...provider, status: 'active', sourceCount: 1 })).toBe(
      'Enabled'
    )
  })
  it.each([
    ['sync_failed', 'Sync failed'],
    ['account_sync_incomplete', 'Some accounts are not up to date'],
    ['document_indexing_failed', 'Some documents failed to index'],
  ] as const)('describes %s and keeps concurrent recovery visible', (issue, label) => {
    expect(organizationSearchStatusLabel({ ...provider, status: 'needs_attention', issue })).toBe(
      label
    )
    expect(
      organizationSearchStatusLabel({
        ...provider,
        status: 'needs_attention',
        issue,
        isSyncing: true,
      })
    ).toBe(`Indexing · ${label}`)
  })
  it('shows deactivation ahead of a retained failure', () => {
    expect(
      organizationSearchStatusLabel({
        ...provider,
        approved: false,
        status: 'needs_attention',
        issue: 'sync_failed',
      })
    ).toBe('Disabled')
  })
})

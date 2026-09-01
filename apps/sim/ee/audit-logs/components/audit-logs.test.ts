/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { AuditLogPage } from '@/lib/api/contracts/audit-logs'
import { presentableAuditEntries } from '@/ee/audit-logs/components/audit-logs'

function page(...ids: string[]): AuditLogPage {
  return {
    success: true,
    data: ids.map((id) => ({
      id,
      workspaceId: null,
      actorId: null,
      actorName: null,
      actorEmail: null,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: null,
      resourceName: null,
      description: null,
      metadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  }
}

describe('presentableAuditEntries', () => {
  it('flattens every loaded page while the scope is answerable', () => {
    expect(presentableAuditEntries([page('a', 'b'), page('c')], true).map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  /**
   * The case this exists for: an unresolved workspace scope drops the filter, so its
   * query key equals the unscoped feed's. Disabling the query does not clear that
   * cache entry, so an admin who had just been reading the organization-wide feed
   * would have kept its rows on screen under a scoped URL — and Export, which gates
   * on this list being non-empty, stayed armed against them.
   */
  it('presents nothing when the scope cannot be answered, even with pages cached', () => {
    expect(presentableAuditEntries([page('a', 'b')], false)).toEqual([])
  })

  it('presents nothing before any page has loaded', () => {
    expect(presentableAuditEntries(undefined, true)).toEqual([])
  })
})

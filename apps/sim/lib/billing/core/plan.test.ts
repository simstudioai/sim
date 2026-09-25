import { member, organization, subscription } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { billingSubscriptionUtilsMock } from '@sim/testing/mocks/billing-subscription-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/subscriptions/utils', () => billingSubscriptionUtilsMock)

import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'

/**
 * `getHighestPrioritySubscription` issues up to four queries keyed by table:
 *   - `subscription` for the user's personal subs (parallelized with members)
 *   - `member`       for the user's org memberships  (parallelized with subs)
 *   - `organization` for the org-existence follow-up
 *   - `subscription` again for the org-scoped subs follow-up
 *
 * Results are routed by the table object passed to `.from()` via
 * `queueTableRows` (FIFO per table: first `subscription` read = personal,
 * second = org). `dbChainMockFns.from` call args record which tables were
 * queried so we can assert the parallelized pair both run and that follow-ups
 * are skipped when appropriate.
 */
function fromTables(): unknown[] {
  return dbChainMockFns.from.mock.calls.map(([table]) => table)
}

interface SubRow {
  id: string
  referenceId: string
  plan: string
  status: string
}

function personalPro(userId: string): SubRow {
  return { id: 'sub-personal-pro', referenceId: userId, plan: 'pro', status: 'active' }
}

function orgEnterprise(orgId: string): SubRow {
  return { id: 'sub-org-enterprise', referenceId: orgId, plan: 'enterprise', status: 'active' }
}

describe('getHighestPrioritySubscription', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('picks the org Enterprise sub over a personal Pro sub (priority order)', async () => {
    queueTableRows(subscription, [personalPro('user-1')]) // personalSubs query
    queueTableRows(member, [{ organizationId: 'org-1' }]) // memberships query
    queueTableRows(organization, [{ id: 'org-1' }]) // org-existence query
    queueTableRows(subscription, [orgEnterprise('org-1')]) // org-subscriptions query

    const result = await getHighestPrioritySubscription('user-1')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('sub-org-enterprise')
    expect(result?.plan).toBe('enterprise')
  })

  it('selection is deterministic regardless of which parallelized query resolves first', async () => {
    queueTableRows(subscription, [personalPro('user-1')])
    queueTableRows(member, [{ organizationId: 'org-1' }])
    queueTableRows(organization, [{ id: 'org-1' }])
    queueTableRows(subscription, [orgEnterprise('org-1')])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-org-enterprise')
  })

  it('returns the personal sub and skips org follow-ups when there are no memberships', async () => {
    queueTableRows(subscription, [personalPro('user-1')])
    queueTableRows(member, [])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-personal-pro')
    expect(result?.plan).toBe('pro')
    // org-existence + org-subscription follow-ups are NOT issued.
    expect(fromTables()).not.toContain(organization)
    expect(fromTables().filter((t) => t === subscription)).toHaveLength(1)
  })

  it('excludes orphaned org memberships whose organization row no longer exists', async () => {
    queueTableRows(subscription, [])
    queueTableRows(member, [{ organizationId: 'ghost-org' }]) // membership points at a deleted org
    queueTableRows(organization, [])

    const result = await getHighestPrioritySubscription('user-1')

    // Org subs are never fetched (no valid org ids) -> falls back to null.
    expect(result).toBeNull()
    expect(fromTables()).toContain(organization)
    // Only the initial personal-subs read on `subscription`; org-subs query skipped.
    expect(fromTables().filter((t) => t === subscription)).toHaveLength(1)
  })

  it('falls back to the personal sub when the only org is orphaned', async () => {
    queueTableRows(subscription, [personalPro('user-1')])
    queueTableRows(member, [{ organizationId: 'ghost-org' }])
    queueTableRows(organization, [])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-personal-pro')
    expect(fromTables().filter((t) => t === subscription)).toHaveLength(1)
  })
})

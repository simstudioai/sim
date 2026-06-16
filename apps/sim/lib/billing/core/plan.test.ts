/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Drizzle mock for `getHighestPrioritySubscription`. It issues up to four
 * queries keyed by table:
 *   - `subscription` for the user's personal subs (parallelized with members)
 *   - `member`       for the user's org memberships  (parallelized with subs)
 *   - `organization` for the org-existence follow-up
 *   - `subscription` again for the org-scoped subs follow-up
 *
 * The mock routes results by the table object passed to `.from()`, serving the
 * (twice-read) `subscription` table from a FIFO queue (first read = personal,
 * second = org). It records which tables were queried so we can assert the
 * parallelized pair both run and that follow-ups are skipped when appropriate.
 *
 * Table sentinels and shared mock state live inside `vi.hoisted` so the
 * `vi.mock` factories (hoisted to the top of the file) can reference them.
 */
const { SUBSCRIPTION_TABLE, MEMBER_TABLE, ORGANIZATION_TABLE, resultsByTable, fromCalls, select } =
  vi.hoisted(() => {
    const SUBSCRIPTION_TABLE = { __table: 'subscription' }
    const MEMBER_TABLE = { __table: 'member' }
    const ORGANIZATION_TABLE = { __table: 'organization' }

    const resultsByTable: Record<string, unknown[][]> = {
      subscription: [],
      member: [],
      organization: [],
    }
    const fromCalls: string[] = []

    const select = vi.fn(() => ({
      from: (table: { __table: string }) => {
        fromCalls.push(table.__table)
        const where = () => {
          const queue = resultsByTable[table.__table]
          const next = queue.length > 0 ? queue.shift() : []
          return Promise.resolve(next ?? [])
        }
        return { where }
      },
    }))

    return {
      SUBSCRIPTION_TABLE,
      MEMBER_TABLE,
      ORGANIZATION_TABLE,
      resultsByTable,
      fromCalls,
      select,
    }
  })

vi.mock('@sim/db', () => ({
  db: { select },
}))

vi.mock('@sim/db/schema', () => ({
  subscription: SUBSCRIPTION_TABLE,
  member: MEMBER_TABLE,
  organization: ORGANIZATION_TABLE,
}))

/**
 * Realistic plan-check predicates so `pickHighestPrioritySubscription` exercises
 * the real Enterprise > Team > Pro priority ordering over the rows we feed it.
 */
vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'past_due'],
  checkEnterprisePlan: (s: any) =>
    s?.plan === 'enterprise' && ['active', 'past_due'].includes(s?.status),
  checkTeamPlan: (s: any) => s?.plan === 'team' && ['active', 'past_due'].includes(s?.status),
  checkProPlan: (s: any) => s?.plan === 'pro' && ['active', 'past_due'].includes(s?.status),
}))

import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'

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

function queue(table: 'subscription' | 'member' | 'organization', rows: unknown[]) {
  resultsByTable[table].push(rows)
}

describe('getHighestPrioritySubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resultsByTable.subscription = []
    resultsByTable.member = []
    resultsByTable.organization = []
    fromCalls.length = 0
  })

  it('picks the org Enterprise sub over a personal Pro sub (priority order)', async () => {
    queue('subscription', [personalPro('user-1')]) // personalSubs query
    queue('member', [{ organizationId: 'org-1' }]) // memberships query
    queue('organization', [{ id: 'org-1' }]) // org-existence query
    queue('subscription', [orgEnterprise('org-1')]) // org-subscriptions query

    const result = await getHighestPrioritySubscription('user-1')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('sub-org-enterprise')
    expect(result?.plan).toBe('enterprise')
  })

  it('selection is deterministic regardless of which parallelized query resolves first', async () => {
    queue('subscription', [personalPro('user-1')])
    queue('member', [{ organizationId: 'org-1' }])
    queue('organization', [{ id: 'org-1' }])
    queue('subscription', [orgEnterprise('org-1')])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-org-enterprise')
  })

  it('issues BOTH the personal-subscriptions and memberships queries (parallelized pair)', async () => {
    queue('subscription', [personalPro('user-1')])
    queue('member', [{ organizationId: 'org-1' }])
    queue('organization', [{ id: 'org-1' }])
    queue('subscription', [orgEnterprise('org-1')])

    await getHighestPrioritySubscription('user-1')

    expect(fromCalls).toContain('subscription')
    expect(fromCalls).toContain('member')
    // First two queries are exactly the parallelized pair (in either order).
    expect(fromCalls.slice(0, 2).sort()).toEqual(['member', 'subscription'])
  })

  it('returns the personal sub and skips org follow-ups when there are no memberships', async () => {
    queue('subscription', [personalPro('user-1')])
    queue('member', [])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-personal-pro')
    expect(result?.plan).toBe('pro')
    // org-existence + org-subscription follow-ups are NOT issued.
    expect(fromCalls).not.toContain('organization')
    expect(fromCalls.filter((t) => t === 'subscription')).toHaveLength(1)
  })

  it('returns null when neither personal nor org subscriptions exist', async () => {
    queue('subscription', [])
    queue('member', [])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result).toBeNull()
  })

  it('excludes orphaned org memberships whose organization row no longer exists', async () => {
    queue('subscription', [])
    queue('member', [{ organizationId: 'ghost-org' }]) // membership points at a deleted org
    queue('organization', [])

    const result = await getHighestPrioritySubscription('user-1')

    // Org subs are never fetched (no valid org ids) -> falls back to null.
    expect(result).toBeNull()
    expect(fromCalls).toContain('organization')
    // Only the initial personal-subs read on `subscription`; org-subs query skipped.
    expect(fromCalls.filter((t) => t === 'subscription')).toHaveLength(1)
  })

  it('falls back to the personal sub when the only org is orphaned', async () => {
    queue('subscription', [personalPro('user-1')])
    queue('member', [{ organizationId: 'ghost-org' }])
    queue('organization', [])

    const result = await getHighestPrioritySubscription('user-1')

    expect(result?.id).toBe('sub-personal-pro')
    expect(fromCalls.filter((t) => t === 'subscription')).toHaveLength(1)
  })
})

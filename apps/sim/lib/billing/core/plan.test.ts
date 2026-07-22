/**
 * @vitest-environment node
 */
import { member, organization, subscription } from '@sim/db/schema'
import { databaseMock, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import type { Mock } from 'vitest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

/**
 * Realistic plan-check predicates so `pickHighestPrioritySubscription` exercises
 * the real Enterprise > Team > Pro priority ordering over the rows we feed it.
 */
vi.mock('@/lib/billing/subscriptions/utils', () => ({
  ENTITLED_SUBSCRIPTION_STATUSES: ['active', 'past_due'],
  checkEnterprisePlan: (s: { plan?: string; status?: string } | null) =>
    s?.plan === 'enterprise' && ['active', 'past_due'].includes(s?.status ?? ''),
  checkTeamPlan: (s: { plan?: string; status?: string } | null) =>
    s?.plan === 'team' && ['active', 'past_due'].includes(s?.status ?? ''),
  checkProPlan: (s: { plan?: string; status?: string } | null) =>
    s?.plan === 'pro' && ['active', 'past_due'].includes(s?.status ?? ''),
}))

import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'

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
 * The routing implementation is installed in `beforeEach` onto the SHARED
 * `dbChainMockFns.select` (this file mocks `@sim/db` with `dbChainMock`) AND
 * mirrored onto the setup-level `databaseMock` entry points. Under
 * `isolate: false` the module under test may have been loaded by an earlier
 * suite in this worker with `@sim/db` bound to `databaseMock` — pointing both
 * shared instances at the same routing keeps either binding correct. Table
 * identity likewise relies on the setup-level `@sim/db/schema` mock (no local
 * schema factory), which is stable across suites in the shared worker.
 */
type TableName = 'subscription' | 'member' | 'organization'

const TABLE_NAMES = new Map<unknown, TableName>([
  [subscription, 'subscription'],
  [member, 'member'],
  [organization, 'organization'],
])

const resultsByTable: Record<TableName, unknown[][]> = {
  subscription: [],
  member: [],
  organization: [],
}
const fromCalls: string[] = []

function routedSelect() {
  return {
    from: (table: unknown) => {
      const name = TABLE_NAMES.get(table)
      if (name) fromCalls.push(name)
      const where = () => {
        const queue = name ? resultsByTable[name] : undefined
        const next = queue && queue.length > 0 ? queue.shift() : []
        return Promise.resolve(next ?? [])
      }
      return { where }
    },
  }
}

const GLOBAL_DB_KEYS = [
  'select',
  'selectDistinct',
  'insert',
  'update',
  'delete',
  'transaction',
] as const

const globalDb = databaseMock.db as unknown as Record<(typeof GLOBAL_DB_KEYS)[number], Mock>
const savedGlobalDbImpls = new Map<
  (typeof GLOBAL_DB_KEYS)[number],
  ((...args: unknown[]) => unknown) | undefined
>()

/** Mirrors the setup-level databaseMock entry points onto the shared chain fns. */
function delegateGlobalDbToChainMocks(): void {
  for (const key of GLOBAL_DB_KEYS) {
    const fn = globalDb[key]
    if (typeof fn?.mockImplementation !== 'function') continue
    if (!savedGlobalDbImpls.has(key)) savedGlobalDbImpls.set(key, fn.getMockImplementation())
    fn.mockImplementation((...args: unknown[]) => (dbChainMockFns[key] as Mock)(...args))
  }
}

/** Restores the databaseMock entry points captured before this suite ran. */
function restoreGlobalDb(): void {
  for (const [key, impl] of savedGlobalDbImpls) {
    if (impl) globalDb[key].mockImplementation(impl)
  }
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

function queue(table: TableName, rows: unknown[]) {
  resultsByTable[table].push(rows)
}

describe('getHighestPrioritySubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resultsByTable.subscription = []
    resultsByTable.member = []
    resultsByTable.organization = []
    fromCalls.length = 0
    dbChainMockFns.select.mockImplementation(routedSelect)
    delegateGlobalDbToChainMocks()
  })

  afterAll(() => {
    resetDbChainMock()
    restoreGlobalDb()
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

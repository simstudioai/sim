/**
 * @vitest-environment node
 */
import type { Sql } from 'postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInfo, mockWarn } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: mockInfo,
    warn: mockWarn,
  }),
}))

import {
  assertFrozenBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  createPausedBillingAttributionStore,
  MAX_PAUSED_BILLING_SNAPSHOT_BYTES,
  type PausedBillingAttributionStore,
  type PausedExecutionCandidate,
  runPausedBillingAttributionBackfill,
  type SubscriptionCandidate,
  selectFrozenPersonalSubscription,
} from './script-migrations/0002_backfill_paused_billing_attribution'
import { scriptMigrations } from './script-migrations/index'

beforeEach(() => {
  vi.clearAllMocks()
})

const ORGANIZATION_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: 'organization-1',
  billedAccountUserId: 'payer-1',
  billingEntity: { type: 'organization', id: 'organization-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: {
    id: 'subscription-1',
    referenceId: 'organization-1',
    plan: 'team_6000',
    status: 'active',
    seats: 4,
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  },
}

interface CandidateOptions {
  attribution?: unknown
  includeAttribution?: boolean
  malformedSnapshot?: boolean
  workspaceId?: string
}

function createCandidate(id: string, options: CandidateOptions = {}): PausedExecutionCandidate {
  const workflowId = `workflow-${id}`
  const executionId = `execution-${id}`
  const metadata: Record<string, unknown> = {
    requestId: `request-${id}`,
    executionId,
    workflowId,
    workspaceId: options.workspaceId ?? 'workspace-1',
    userId: 'actor-1',
  }
  if (options.includeAttribution) {
    metadata.billingAttribution = options.attribution
  }
  const executionSnapshot = {
    snapshot: options.malformedSnapshot
      ? '{not-json'
      : JSON.stringify({
          metadata,
          workflow: { id: workflowId },
          input: {},
          workflowVariables: {},
          selectedOutputs: [],
        }),
    triggerIds: [],
  }

  return {
    executionId,
    executionSnapshot,
    id,
    snapshotBytes: Buffer.byteLength(JSON.stringify(executionSnapshot), 'utf8'),
    workflowId,
  }
}

function createSubscription(
  id: string,
  referenceId: string,
  plan: string,
  overrides: Partial<SubscriptionCandidate> = {}
): SubscriptionCandidate {
  return {
    id,
    periodEnd: '2026-08-01 00:00:00',
    periodStart: '2026-07-01 00:00:00',
    plan,
    referenceId,
    seats: 1,
    status: 'active',
    ...overrides,
  }
}

function createStore(candidates: PausedExecutionCandidate[]) {
  const rows = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const pageCalls: Array<{ afterId: string | undefined; limit: number }> = []
  const writes: Array<{ id: string; nextExecutionSnapshot: unknown }> = []
  const workspacePayers = new Map([
    [
      'workspace-1',
      {
        billedAccountUserId: 'payer-1',
        organizationId: 'organization-1' as string | null,
      },
    ],
  ])
  const organizationSubscriptions = new Map<string, SubscriptionCandidate | null>([
    [
      'organization-1',
      createSubscription('subscription-1', 'organization-1', 'team_6000', { seats: 4 }),
    ],
  ])
  const personalSubscriptions = new Map<string, SubscriptionCandidate[]>()

  const store: PausedBillingAttributionStore = {
    async listActiveIds(afterId, limit) {
      pageCalls.push({ afterId, limit })
      return [...rows.keys()]
        .filter((id) => afterId === undefined || id > afterId)
        .sort()
        .slice(0, limit)
        .map((id) => ({ id }))
    },
    async loadActive(id) {
      return rows.get(id) ?? null
    },
    async loadWorkspacePayer(workspaceId) {
      return workspacePayers.get(workspaceId) ?? null
    },
    async loadOrganizationSubscription(organizationId) {
      return organizationSubscriptions.get(organizationId) ?? null
    },
    async listPersonalSubscriptions(userId) {
      return personalSubscriptions.get(userId) ?? []
    },
    async writeAttribution(update) {
      const current = rows.get(update.id)
      if (
        !current ||
        JSON.stringify(current.executionSnapshot) !==
          JSON.stringify(update.expectedExecutionSnapshot)
      ) {
        return false
      }
      writes.push({ id: update.id, nextExecutionSnapshot: update.nextExecutionSnapshot })
      rows.set(update.id, {
        ...current,
        executionSnapshot: update.nextExecutionSnapshot,
        snapshotBytes: Buffer.byteLength(JSON.stringify(update.nextExecutionSnapshot), 'utf8'),
      })
      return true
    },
  }

  return {
    organizationSubscriptions,
    pageCalls,
    personalSubscriptions,
    rows,
    store,
    workspacePayers,
    writes,
  }
}

function readInnerSnapshot(candidate: PausedExecutionCandidate): Record<string, unknown> {
  if (
    typeof candidate.executionSnapshot !== 'object' ||
    candidate.executionSnapshot === null ||
    !('snapshot' in candidate.executionSnapshot) ||
    typeof candidate.executionSnapshot.snapshot !== 'string'
  ) {
    throw new Error('Expected a serialized paused execution snapshot')
  }
  return JSON.parse(candidate.executionSnapshot.snapshot)
}

describe('paused billing attribution serialization', () => {
  it('writes canonical organization attribution with exact inner snapshot bytes', async () => {
    const candidate = createCandidate('row-1')
    const harness = createStore([candidate])

    const summary = await runPausedBillingAttributionBackfill(harness.store)

    expect(summary).toMatchObject({ malformed: 0, migrated: 1, scanned: 1 })
    const persisted = harness.rows.get(candidate.id)
    if (!persisted) throw new Error('Expected persisted candidate')
    const expectedSnapshot = JSON.stringify({
      metadata: {
        requestId: 'request-row-1',
        executionId: 'execution-row-1',
        workflowId: 'workflow-row-1',
        workspaceId: 'workspace-1',
        userId: 'actor-1',
        billingAttribution: ORGANIZATION_ATTRIBUTION,
      },
      workflow: { id: 'workflow-row-1' },
      input: {},
      workflowVariables: {},
      selectedOutputs: [],
    })
    expect((persisted.executionSnapshot as { snapshot: string }).snapshot).toBe(expectedSnapshot)
    expect(
      assertFrozenBillingAttributionSnapshot(
        (readInnerSnapshot(persisted).metadata as Record<string, unknown>).billingAttribution
      )
    ).toEqual(ORGANIZATION_ATTRIBUTION)
  })

  it('uses the exact open billing period when a subscription endpoint is absent', async () => {
    const candidate = createCandidate('row-1')
    const harness = createStore([candidate])
    harness.organizationSubscriptions.set(
      'organization-1',
      createSubscription('subscription-1', 'organization-1', 'team', {
        periodEnd: null,
      })
    )

    await runPausedBillingAttributionBackfill(harness.store)

    const persisted = harness.rows.get(candidate.id)
    if (!persisted) throw new Error('Expected persisted candidate')
    const attribution = (
      readInnerSnapshot(persisted).metadata as {
        billingAttribution: BillingAttributionSnapshot
      }
    ).billingAttribution
    expect(attribution.billingPeriod).toEqual({
      start: '1970-01-01T00:00:00.000Z',
      end: '9999-12-31T00:00:00.000Z',
    })
    expect(attribution.payerSubscription).toMatchObject({
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: null,
    })
  })

  it('writes a personal payer with no recognized subscription', async () => {
    const candidate = createCandidate('row-1')
    const harness = createStore([candidate])
    harness.workspacePayers.set('workspace-1', {
      billedAccountUserId: 'payer-1',
      organizationId: null,
    })
    harness.personalSubscriptions.set('payer-1', [createSubscription('free-1', 'payer-1', 'free')])

    await runPausedBillingAttributionBackfill(harness.store)

    const persisted = harness.rows.get(candidate.id)
    if (!persisted) throw new Error('Expected persisted candidate')
    const attribution = (
      readInnerSnapshot(persisted).metadata as {
        billingAttribution: BillingAttributionSnapshot
      }
    ).billingAttribution
    expect(attribution).toMatchObject({
      organizationId: null,
      billedAccountUserId: 'payer-1',
      billingEntity: { type: 'user', id: 'payer-1' },
      billingPeriod: {
        start: '1970-01-01T00:00:00.000Z',
        end: '9999-12-31T00:00:00.000Z',
      },
      payerSubscription: null,
    })
  })
})

describe('paused billing attribution subscription selection', () => {
  it('uses Enterprise then Team then Pro priority, including suffixed plans', () => {
    const subscriptions = [
      createSubscription('pro', 'payer-1', 'pro_25000'),
      createSubscription('team', 'payer-1', 'team_6000'),
      createSubscription('enterprise', 'payer-1', 'enterprise', { status: 'past_due' }),
    ]

    expect(selectFrozenPersonalSubscription(subscriptions)?.id).toBe('enterprise')
    expect(selectFrozenPersonalSubscription(subscriptions.slice(0, 2))?.id).toBe('team')
    expect(selectFrozenPersonalSubscription(subscriptions.slice(0, 1))?.id).toBe('pro')
  })

  it('fails closed when the highest personal tier is ambiguous', () => {
    const subscriptions = [
      createSubscription('team-1', 'payer-1', 'team'),
      createSubscription('team-2', 'payer-1', 'team_25000'),
      createSubscription('pro-1', 'payer-1', 'pro'),
    ]

    expect(() => selectFrozenPersonalSubscription(subscriptions)).toThrow(
      'same highest-priority tier'
    )
  })

  it('uses canonical organization subscription SQL ordering', async () => {
    const queries: string[] = []
    const fakeSql = ((strings: TemplateStringsArray) => {
      const query = strings.join('?').replace(/\s+/g, ' ').trim()
      queries.push(query)
      return Promise.resolve([])
    }) as unknown as Sql
    const store = createPausedBillingAttributionStore(fakeSql)

    await store.loadOrganizationSubscription('organization-1')

    expect(queries[0]).toContain('status = ANY(?::text[])')
    expect(queries[0]).toContain('ORDER BY period_start DESC, id DESC')
    expect(queries[0]).toContain('LIMIT 1')
  })
})

describe('paused billing attribution safety', () => {
  it('never overwrites valid or malformed existing attribution', async () => {
    const valid = createCandidate('row-1', {
      attribution: ORGANIZATION_ATTRIBUTION,
      includeAttribution: true,
    })
    const malformed = createCandidate('row-2', {
      attribution: { actorUserId: 'actor-1' },
      includeAttribution: true,
    })
    const harness = createStore([valid, malformed])

    const summary = await runPausedBillingAttributionBackfill(harness.store)

    expect(summary).toMatchObject({ existing: 1, malformed: 1, migrated: 0 })
    expect(harness.writes).toHaveLength(0)
    expect(harness.rows.get(valid.id)?.executionSnapshot).toBe(valid.executionSnapshot)
    expect(harness.rows.get(malformed.id)?.executionSnapshot).toBe(malformed.executionSnapshot)
  })

  it('logs and skips malformed, mismatched, and oversized legacy rows', async () => {
    const malformed = createCandidate('row-1', { malformedSnapshot: true })
    const mismatched = createCandidate('row-2')
    if (typeof mismatched.executionSnapshot !== 'object' || mismatched.executionSnapshot === null) {
      throw new Error('Expected execution snapshot object')
    }
    const mismatchedInner = readInnerSnapshot(mismatched)
    ;(mismatchedInner.metadata as Record<string, unknown>).executionId = 'other-execution'
    mismatched.executionSnapshot = {
      ...mismatched.executionSnapshot,
      snapshot: JSON.stringify(mismatchedInner),
    }
    const oversized = createCandidate('row-3')
    oversized.snapshotBytes = MAX_PAUSED_BILLING_SNAPSHOT_BYTES + 1
    const harness = createStore([malformed, mismatched, oversized])

    const summary = await runPausedBillingAttributionBackfill(harness.store, 2)

    expect(summary).toMatchObject({ batches: 2, malformed: 3, migrated: 0, scanned: 3 })
    expect(mockWarn).toHaveBeenCalledTimes(3)
    expect(harness.writes).toHaveLength(0)
  })

  it('preserves a concurrent value when full-snapshot compare-and-swap loses', async () => {
    const candidate = createCandidate('row-1')
    const harness = createStore([candidate])
    const concurrentSnapshot = { snapshot: '{"concurrent":true}', triggerIds: [] }
    harness.store.writeAttribution = async () => {
      harness.rows.set(candidate.id, {
        ...candidate,
        executionSnapshot: concurrentSnapshot,
      })
      return false
    }

    const summary = await runPausedBillingAttributionBackfill(harness.store)

    expect(summary).toMatchObject({ conflicted: 1, migrated: 0 })
    expect(harness.rows.get(candidate.id)?.executionSnapshot).toBe(concurrentSnapshot)
  })

  it('is idempotent and processes bounded keyset pages sequentially', async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => createCandidate(`row-${index + 1}`))
    const harness = createStore(candidates)
    let activeLoads = 0
    let maxActiveLoads = 0
    const loadWorkspacePayer = harness.store.loadWorkspacePayer.bind(harness.store)
    harness.store.loadWorkspacePayer = async (workspaceId) => {
      activeLoads += 1
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads)
      await Promise.resolve()
      const payer = await loadWorkspacePayer(workspaceId)
      activeLoads -= 1
      return payer
    }

    const first = await runPausedBillingAttributionBackfill(harness.store, 2)
    const second = await runPausedBillingAttributionBackfill(harness.store, 2)

    expect(first).toMatchObject({ batches: 3, migrated: 5, scanned: 5 })
    expect(second).toMatchObject({ batches: 3, existing: 5, migrated: 0, scanned: 5 })
    expect(maxActiveLoads).toBe(1)
    expect(harness.pageCalls.slice(0, 4)).toEqual([
      { afterId: undefined, limit: 2 },
      { afterId: 'row-2', limit: 2 },
      { afterId: 'row-4', limit: 2 },
      { afterId: 'row-5', limit: 2 },
    ])
  })

  it('throws systemic store failures instead of treating them as malformed rows', async () => {
    const harness = createStore([createCandidate('row-1')])
    harness.store.loadWorkspacePayer = vi.fn().mockRejectedValue(new Error('database offline'))

    await expect(runPausedBillingAttributionBackfill(harness.store)).rejects.toThrow(
      'database offline'
    )
  })
})

describe('script migration registry', () => {
  it('keeps script migrations in append-only order', () => {
    expect(scriptMigrations.map((migration) => migration.name)).toEqual([
      '0001_backfill_table_order_keys',
      '0002_backfill_paused_billing_attribution',
      '0003_backfill_workspace_storage_usage',
    ])
  })
})

/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  assertCutoverClean,
  buildAttributedPausedExecutionSnapshot,
  type ConditionalPausedAttributionUpdate,
  type CutoverInventory,
  migratePausedExecutions,
  PAUSED_MIGRATION_CONFIRMATION,
  type PausedExecutionCandidate,
  type PausedExecutionStore,
  parseArgs,
  parsePausedExecutionSnapshot,
} from '@/scripts/billing-attribution-cutover-inventory'

const BILLING_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: 'organization-1',
  billedAccountUserId: 'payer-1',
  billingEntity: { type: 'organization', id: 'organization-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const CONCURRENT_ATTRIBUTION: BillingAttributionSnapshot = {
  ...BILLING_ATTRIBUTION,
  organizationId: 'organization-2',
  billingEntity: { type: 'organization', id: 'organization-2' },
}

interface SnapshotOptions {
  attribution?: BillingAttributionSnapshot | null
  includeAttribution?: boolean
  malformed?: boolean
}

function createCandidate(id: string, options: SnapshotOptions = {}): PausedExecutionCandidate {
  const workflowId = `workflow-${id}`
  const executionId = `execution-${id}`
  const metadata: Record<string, unknown> = {
    requestId: `request-${id}`,
    executionId,
    workflowId,
    workspaceId: 'workspace-1',
    userId: 'actor-1',
  }
  if (options.includeAttribution) {
    metadata.billingAttribution = options.attribution
  }
  const executionSnapshot = {
    snapshot: options.malformed
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
    status: 'paused',
    workflowId,
  }
}

function createStore(candidates: PausedExecutionCandidate[]) {
  const rows = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const pageCalls: Array<{ afterId: string | undefined; limit: number }> = []
  const writeCalls: ConditionalPausedAttributionUpdate[] = []
  const store: PausedExecutionStore = {
    async listActiveIds(afterId, limit) {
      pageCalls.push({ afterId, limit })
      return [...rows.values()]
        .filter((row) => afterId === undefined || row.id > afterId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit)
        .map(({ id }) => ({ id }))
    },
    async loadActive(id) {
      return rows.get(id) ?? null
    },
    async writeAttribution(update) {
      writeCalls.push(update)
      const current = rows.get(update.id)
      if (
        !current ||
        JSON.stringify(current.executionSnapshot) !==
          JSON.stringify(update.expectedExecutionSnapshot)
      ) {
        return false
      }
      const nextExecutionSnapshot = update.nextExecutionSnapshot
      rows.set(update.id, {
        ...current,
        executionSnapshot: nextExecutionSnapshot,
        snapshotBytes: Buffer.byteLength(JSON.stringify(nextExecutionSnapshot), 'utf8'),
      })
      return true
    },
  }

  return { pageCalls, rows, store, writeCalls }
}

function createInventory(overrides: Partial<CutoverInventory> = {}): CutoverInventory {
  return {
    asyncJobs: [],
    invalidPausedSnapshots: 0,
    pausedExecutions: [],
    pausedExecutionsScanned: 0,
    totalBlockingRows: 0,
    workflowExecutions: [],
    ...overrides,
  }
}

describe('billing attribution paused snapshot parsing', () => {
  it('extracts persisted actor/workspace and writes the exact nested resume metadata', () => {
    const candidate = createCandidate('row-1')
    const parsed = parsePausedExecutionSnapshot(candidate)

    expect(parsed).toMatchObject({
      actorUserId: 'actor-1',
      state: 'missing',
      workspaceId: 'workspace-1',
    })
    if (parsed.state !== 'missing') throw new Error('Expected missing attribution')

    const next = buildAttributedPausedExecutionSnapshot(parsed, BILLING_ATTRIBUTION)
    const nested = JSON.parse(next.snapshot as string)
    expect(nested.metadata.billingAttribution).toEqual(BILLING_ATTRIBUTION)

    const reparsed = parsePausedExecutionSnapshot({
      ...candidate,
      executionSnapshot: next,
    })
    expect(reparsed.state).toBe('attributed')
    if (reparsed.state !== 'attributed') throw new Error('Expected attributed snapshot')
    expect(Object.isFrozen(reparsed.billingAttribution)).toBe(true)
  })

  it('fails closed on malformed legacy snapshot JSON', async () => {
    const candidate = createCandidate('row-1', { malformed: true })
    const harness = createStore([candidate])
    const resolveAttribution = vi.fn()

    expect(() => parsePausedExecutionSnapshot(candidate)).toThrow(
      'Paused execution snapshot JSON is malformed'
    )
    const summary = await migratePausedExecutions({
      batchSize: 1,
      resolveAttribution,
      store: harness.store,
    })

    expect(summary).toMatchObject({ failed: 1, migrated: 0, skipped: 0 })
    expect(resolveAttribution).not.toHaveBeenCalled()
    expect(harness.writeCalls).toHaveLength(0)
    expect(harness.rows.get(candidate.id)?.executionSnapshot).toBe(candidate.executionSnapshot)
  })
})

describe('billing attribution paused migration', () => {
  it('is idempotent after a successful conditional update', async () => {
    const harness = createStore([createCandidate('row-1')])
    const resolveAttribution = vi.fn().mockResolvedValue(BILLING_ATTRIBUTION)

    const first = await migratePausedExecutions({
      batchSize: 1,
      resolveAttribution,
      store: harness.store,
    })
    const second = await migratePausedExecutions({
      batchSize: 1,
      resolveAttribution,
      store: harness.store,
    })

    expect(first).toMatchObject({ failed: 0, migrated: 1, skipped: 0 })
    expect(second).toMatchObject({ failed: 0, migrated: 0, skipped: 1 })
    expect(resolveAttribution).toHaveBeenCalledTimes(1)
    expect(harness.writeCalls).toHaveLength(1)
  })

  it('does not overwrite a concurrent snapshot attribution', async () => {
    const candidate = createCandidate('row-1')
    const harness = createStore([candidate])
    const conditionalWrite = harness.store.writeAttribution.bind(harness.store)
    harness.store.writeAttribution = async (update) => {
      const current = harness.rows.get(update.id)
      if (!current) return false
      const parsed = parsePausedExecutionSnapshot(current)
      if (parsed.state !== 'missing') return false
      const concurrentSnapshot = buildAttributedPausedExecutionSnapshot(
        parsed,
        CONCURRENT_ATTRIBUTION
      )
      harness.rows.set(update.id, {
        ...current,
        executionSnapshot: concurrentSnapshot,
        snapshotBytes: Buffer.byteLength(JSON.stringify(concurrentSnapshot), 'utf8'),
      })
      return conditionalWrite(update)
    }

    const summary = await migratePausedExecutions({
      batchSize: 1,
      resolveAttribution: vi.fn().mockResolvedValue(BILLING_ATTRIBUTION),
      store: harness.store,
    })

    expect(summary).toMatchObject({ failed: 0, migrated: 0, skipped: 1 })
    const persisted = harness.rows.get(candidate.id)
    if (!persisted) throw new Error('Expected persisted row')
    const parsed = parsePausedExecutionSnapshot(persisted)
    expect(parsed.state).toBe('attributed')
    if (parsed.state !== 'attributed') throw new Error('Expected concurrent attribution')
    expect(parsed.billingAttribution.organizationId).toBe('organization-2')
  })

  it('uses bounded keyset pages and resolves rows sequentially', async () => {
    const harness = createStore([
      createCandidate('row-1'),
      createCandidate('row-2'),
      createCandidate('row-3'),
      createCandidate('row-4'),
      createCandidate('row-5'),
    ])
    let activeResolutions = 0
    let maxActiveResolutions = 0
    const resolveAttribution = vi.fn(async () => {
      activeResolutions += 1
      maxActiveResolutions = Math.max(maxActiveResolutions, activeResolutions)
      await Promise.resolve()
      activeResolutions -= 1
      return BILLING_ATTRIBUTION
    })

    const summary = await migratePausedExecutions({
      batchSize: 2,
      resolveAttribution,
      store: harness.store,
    })

    expect(summary).toMatchObject({ batches: 3, failed: 0, migrated: 5, scanned: 5 })
    expect(maxActiveResolutions).toBe(1)
    expect(harness.pageCalls).toEqual([
      { afterId: undefined, limit: 2 },
      { afterId: 'row-2', limit: 2 },
      { afterId: 'row-4', limit: 2 },
      { afterId: 'row-5', limit: 2 },
    ])
  })
})

describe('billing attribution cutover assertions', () => {
  it('keeps inventory read-only by default and requires migration confirmation', () => {
    expect(parseArgs([]).mode).toBe('inventory')
    expect(() => parseArgs(['--migrate-paused'])).toThrow(
      `--confirm-migrate-paused=${PAUSED_MIGRATION_CONFIRMATION}`
    )
    expect(
      parseArgs(['--migrate-paused', `--confirm-migrate-paused=${PAUSED_MIGRATION_CONFIRMATION}`])
        .mode
    ).toBe('migrate-paused')
  })

  it('blocks on DB drains, incomplete paused migration, and Trigger.dev acknowledgement', () => {
    expect(() => assertCutoverClean(createInventory(), false)).toThrow(
      'Trigger.dev drain is not acknowledged'
    )
    expect(() =>
      assertCutoverClean(
        createInventory({
          asyncJobs: [{ count: 1, status: 'pending', type: 'workflow-execution' }],
          pausedExecutions: [{ count: 2, status: 'paused' }],
          workflowExecutions: [{ count: 3, status: 'running' }],
          totalBlockingRows: 6,
        }),
        true
      )
    ).toThrow('active database async job')
    expect(() =>
      assertCutoverClean(
        createInventory({
          pausedExecutions: [{ count: 1, status: 'paused' }],
          totalBlockingRows: 1,
        }),
        true
      )
    ).toThrow('active paused snapshot')
    expect(() => assertCutoverClean(createInventory(), true)).not.toThrow()
  })
})

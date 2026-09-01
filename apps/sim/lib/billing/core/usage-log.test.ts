/**
 * @vitest-environment node
 */
import { usageLog } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetHighestPrioritySubscription,
  mockInsert,
  mockIsOrgScopedSubscription,
  mockOnConflictDoNothing,
  mockReturning,
  mockValues,
  mockTransaction,
  mockUpdate,
} = vi.hoisted(() => ({
  mockGetHighestPrioritySubscription: vi.fn(),
  mockInsert: vi.fn(),
  mockIsOrgScopedSubscription: vi.fn(),
  mockOnConflictDoNothing: vi.fn(),
  mockReturning: vi.fn(),
  mockValues: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdate: vi.fn(),
}))

vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/subscriptions/utils', () => ({
  isOrgScopedSubscription: mockIsOrgScopedSubscription,
}))

import {
  CUMULATIVE_COST_EPSILON,
  CumulativeUsageContextMismatchError,
  getUserUsageLogs,
  getWorkspaceUsageLogs,
  recordCumulativeUsage,
  recordUsage,
  resolveCumulativeTopUp,
  UNKNOWN_CURSOR_MESSAGE,
  UnknownUsageCursorError,
} from '@/lib/billing/core/usage-log'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { HttpError } from '@/lib/core/utils/http-error'

/**
 * Re-wires the shared db mocks (`dbChainMockFns`, backing the single shared
 * `@sim/db` mock instance) to this file's insert/transaction chain.
 */
function installSharedDbMocks(): void {
  resetDbChainMock()
  dbChainMockFns.insert.mockImplementation((...args: unknown[]) => mockInsert(...args))
  dbChainMockFns.transaction.mockImplementation((...args: unknown[]) => mockTransaction(...args))
}

afterAll(() => {
  resetDbChainMock()
})

beforeAll(() => {
  setEnvFlags({ isBillingEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('recordUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installSharedDbMocks()
    mockReturning.mockResolvedValue([{ cost: '0.10' }, { cost: '0.20' }])
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning })
    mockValues.mockReturnValue({
      onConflictDoNothing: mockOnConflictDoNothing,
    })
    mockInsert.mockReturnValue({ values: mockValues })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      referenceId: 'org-1',
    })
    mockIsOrgScopedSubscription.mockReturnValue(true)
  })

  it('commits canonical usage rows with deterministic event keys and billing scope', async () => {
    await recordUsage({
      userId: 'external-actor',
      workspaceId: 'workspace-1',
      billingEntity: { type: 'organization', id: 'workspace-org' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      entries: [
        { category: 'fixed', source: 'workflow', description: 'execution_fee', cost: 0.1 },
        {
          category: 'model',
          source: 'workflow',
          description: 'gpt-4',
          cost: 0.2,
          metadata: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    })

    const values = mockValues.mock.calls[0][0]
    expect(values).toHaveLength(2)
    expect(values[0]).toMatchObject({
      userId: 'external-actor',
      billingEntityId: 'workspace-org',
      billingEntityType: 'organization',
      billingPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
      billingPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
    })
    expect(values[0].eventKey).toMatch(/^[a-f0-9]{64}$/)
    expect(values[1].eventKey).toMatch(/^[a-f0-9]{64}$/)
    expect(values[0].eventKey).not.toBe(values[1].eventKey)
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1)
    expect(mockOnConflictDoNothing.mock.calls[0][0]).toMatchObject({
      target: usageLog.eventKey,
    })
    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('uses pre-resolved billing context without loading subscriptions', async () => {
    await recordUsage({
      userId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      entries: [{ category: 'fixed', source: 'workflow', description: 'execution_fee', cost: 0.1 }],
    })

    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mockValues.mock.calls[0][0][0]).toMatchObject({
      billingEntityId: 'user-1',
      billingEntityType: 'user',
    })
  })

  it('rejects workspace usage without an explicit payer context', async () => {
    await expect(
      recordUsage({
        userId: 'external-actor',
        workspaceId: 'workspace-1',
        entries: [
          { category: 'fixed', source: 'workflow', description: 'execution_fee', cost: 0.1 },
        ],
      })
    ).rejects.toThrow('Workspace usage requires an explicit billing entity and billing period')

    expect(mockGetHighestPrioritySubscription).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('keeps zero-cost unbilled rows and still drops every other zero-cost entry', async () => {
    await recordUsage({
      userId: 'user-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      executionId: 'execution-1',
      entries: [
        {
          category: 'model_unbilled',
          source: 'workflow',
          description: 'claude-sonnet-4',
          cost: 0,
          metadata: { inputTokens: 1200, outputTokens: 340 },
        },
        // A billed category at zero cost is still noise, and stays filtered.
        { category: 'model', source: 'workflow', description: 'gpt-4', cost: 0 },
        { category: 'tool', source: 'workflow', description: 'exa_search', cost: 0 },
      ],
    })

    const values = mockValues.mock.calls[0][0]
    expect(values).toHaveLength(1)
    expect(values[0]).toMatchObject({
      category: 'model_unbilled',
      cost: '0',
      description: 'claude-sonnet-4',
      metadata: { inputTokens: 1200, outputTokens: 340 },
    })
  })

  it('writes nothing when every entry is zero-cost and billable', async () => {
    await recordUsage({
      userId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      entries: [{ category: 'model', source: 'workflow', description: 'gpt-4', cost: 0 }],
    })

    expect(mockInsert).not.toHaveBeenCalled()
  })
})

describe('resolveCumulativeTopUp', () => {
  it('bills the full amount on the first flush (nothing recorded yet)', () => {
    expect(resolveCumulativeTopUp(0, 0.3474447)).toEqual({
      shouldBill: true,
      delta: 0.3474447,
      newTotal: 0.3474447,
    })
  })

  it('bills only the delta when the cumulative grows (recovered request)', () => {
    const result = resolveCumulativeTopUp(0.3474447, 0.4662453)
    expect(result.shouldBill).toBe(true)
    expect(result.newTotal).toBe(0.4662453)
    expect(result.delta).toBeCloseTo(0.1188006, 9)
  })

  it('is a no-op when the cumulative is unchanged (abort-race duplicate)', () => {
    expect(resolveCumulativeTopUp(0.4662453, 0.4662453)).toEqual({
      shouldBill: false,
      delta: 0,
      newTotal: 0.4662453,
    })
  })

  it('is a no-op when an out-of-order flush carries a lower cumulative', () => {
    expect(resolveCumulativeTopUp(0.4662453, 0.3)).toMatchObject({ shouldBill: false, delta: 0 })
  })

  it('ignores sub-epsilon increases from decimal round-trips', () => {
    expect(
      resolveCumulativeTopUp(0.4662453, 0.4662453 + CUMULATIVE_COST_EPSILON / 2)
    ).toMatchObject({ shouldBill: false })
  })
})

describe('recordCumulativeUsage', () => {
  const defaultExistingRow: {
    id: string
    cost: string
    userId: string
    workspaceId: string | null
    billingEntityType: 'user' | 'organization' | null
    billingEntityId: string | null
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
  } = {
    id: 'row-1',
    cost: '0.3474447',
    userId: 'user-1',
    workspaceId: null,
    billingEntityType: 'organization' as const,
    billingEntityId: 'org-1',
    billingPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
    billingPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    installSharedDbMocks()
    mockReturning.mockResolvedValue([{ cost: '0.3474447' }])
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning })
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing })
    mockInsert.mockReturnValue({ values: mockValues })
    mockGetHighestPrioritySubscription.mockResolvedValue({
      periodEnd: new Date('2026-06-01T00:00:00.000Z'),
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      referenceId: 'org-1',
    })
    mockIsOrgScopedSubscription.mockReturnValue(true)
  })

  const setupTx = (existingRow: Partial<typeof defaultExistingRow> | null) => {
    const resolvedExistingRow = existingRow ? { ...defaultExistingRow, ...existingRow } : null
    const limit = vi.fn().mockResolvedValue(resolvedExistingRow ? [resolvedExistingRow] : [])
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
    mockUpdate.mockReturnValue({ set: updateSet })
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select,
      update: mockUpdate,
      insert: mockInsert, // recordUsage(tx) reuses the shared insert chain
    }
    mockTransaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
    return { tx, select, updateSet }
  }

  /** True when any tx.execute call ran a sql`` template containing the substring. */
  const executedSqlContaining = (tx: { execute: ReturnType<typeof vi.fn> }, substring: string) =>
    tx.execute.mock.calls.some(([arg]) => {
      const strings = (arg as { strings?: readonly string[] } | null)?.strings
      return Array.isArray(strings) && strings.some((s) => s.includes(substring))
    })

  it('inserts the full cumulative on the first flush', async () => {
    setupTx(null)
    const result = await recordCumulativeUsage({
      userId: 'external-actor',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'workspace-org' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.3474447,
      eventKey: 'update-cost:msg-1-billing',
      metadata: { inputTokens: 100, outputTokens: 5 },
    })
    expect(result).toEqual({ billed: true, delta: 0.3474447, total: 0.3474447 })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockValues.mock.calls[0][0][0]).toMatchObject({
      userId: 'external-actor',
      billingEntityId: 'workspace-org',
      billingEntityType: 'organization',
    })
  })

  it('tops up to the higher cumulative and bills only the delta', async () => {
    const { updateSet } = setupTx({ id: 'row-1', cost: '0.3474447' })
    const result = await recordCumulativeUsage({
      userId: 'user-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.4662453,
      eventKey: 'update-cost:msg-1-billing',
    })
    expect(result.billed).toBe(true)
    expect(result.total).toBe(0.4662453)
    expect(result.delta).toBeCloseTo(0.1188006, 9)
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ cost: '0.4662453' }))
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('does not bill when the cumulative is not higher than recorded', async () => {
    const { updateSet } = setupTx({ id: 'row-1', cost: '0.4662453' })
    const result = await recordCumulativeUsage({
      userId: 'user-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.4662453,
      eventKey: 'update-cost:msg-1-billing',
    })
    expect(result).toEqual({ billed: false, delta: 0, total: 0.4662453 })
    expect(updateSet).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it.each([
    ['actor', { userId: 'different-actor' }],
    ['workspace', { workspaceId: 'different-workspace' }],
    ['billing entity', { billingEntityId: 'different-organization' }],
    ['billing period', { billingPeriodEnd: new Date('2026-07-01T00:00:00.000Z') }],
  ])('rejects a reused event key bound to a different %s', async (field, override) => {
    setupTx({
      ...defaultExistingRow,
      userId: 'external-actor',
      workspaceId: 'ws-1',
      billingEntityId: 'workspace-org',
      ...override,
    })

    const result = recordCumulativeUsage({
      userId: 'external-actor',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'workspace-org' },
      billingPeriod: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.3474447,
      eventKey: 'update-cost:msg-1-billing',
    })

    await expect(result).rejects.toMatchObject({
      name: CumulativeUsageContextMismatchError.name,
      mismatchedFields: [field],
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('resolves the billing context before opening the locked transaction, exactly once', async () => {
    setupTx(null)
    await recordCumulativeUsage({
      userId: 'user-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.3474447,
      eventKey: 'update-cost:msg-1-billing',
    })
    // One lookup total: pre-resolved outside the tx, and the first-flush
    // insert reuses it instead of re-resolving on the pool inside the tx.
    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledTimes(1)
    expect(mockGetHighestPrioritySubscription.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0]
    )
  })

  it('stamps the pre-resolved billing context onto the first-flush insert', async () => {
    setupTx(null)
    await recordCumulativeUsage({
      userId: 'user-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.3474447,
      eventKey: 'update-cost:msg-1-billing',
    })
    expect(mockValues.mock.calls[0][0][0]).toMatchObject({
      billingEntityId: 'org-1',
      billingEntityType: 'organization',
    })
  })

  it('bounds the advisory-lock wait and locks on the 64-bit event-key hash', async () => {
    const { tx } = setupTx({ id: 'row-1', cost: '0.3474447' })
    await recordCumulativeUsage({
      userId: 'user-1',
      source: 'workspace-chat',
      model: 'claude-opus-4.8',
      cost: 0.4662453,
      eventKey: 'update-cost:msg-1-billing',
    })
    expect(executedSqlContaining(tx, 'lock_timeout')).toBe(true)
    expect(executedSqlContaining(tx, 'pg_advisory_xact_lock')).toBe(true)
    expect(executedSqlContaining(tx, 'hashtextextended')).toBe(true)
  })
})

interface MockCondition {
  type?: string
  conditions?: MockCondition[]
  left?: string
  right?: string
}

function latestWhereCondition(): MockCondition {
  const condition = dbChainMockFns.where.mock.calls.at(-1)?.[0]
  if (!condition) throw new Error('Expected a usage-log where condition')
  return condition as MockCondition
}

describe('usage-log query scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('queries a complete workspace ledger without an actor predicate', async () => {
    await getWorkspaceUsageLogs('workspace-1', { limit: 25, includeSummary: false })

    expect(latestWhereCondition()).toMatchObject({
      type: 'and',
      conditions: [{ type: 'eq', left: 'usageLog.workspaceId', right: 'workspace-1' }],
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(26)
  })

  it('rejects a cursor that resolves to no usage event instead of restarting at page 1', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const rejection = await getUserUsageLogs('user-1', {
      cursor: 'log-from-another-ledger',
      includeSummary: false,
    }).catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(UnknownUsageCursorError)
    expect((rejection as Error).message).toBe(UNKNOWN_CURSOR_MESSAGE)
  })

  /**
   * Both projections of the same throw: the v2 route reads the classification off
   * the `cause` chain, the session-only internal route reads `statusCode` off the
   * `HttpError`. Asserting them here is what lets the route suites stay on the
   * surface behaviour.
   */
  it('classifies the unresolvable-cursor rejection for both surfaces', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const rejection = await getUserUsageLogs('user-1', {
      cursor: 'log-from-another-ledger',
      includeSummary: false,
    }).catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(HttpError)
    expect((rejection as HttpError).statusCode).toBe(400)
    expect(asOrchestrationError(rejection)).toMatchObject({
      code: 'validation',
      message: UNKNOWN_CURSOR_MESSAGE,
    })
  })

  it('narrows the page to rows after a resolvable cursor', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ createdAt: new Date('2026-07-01T00:00:00Z') }])

    await getUserUsageLogs('user-1', { cursor: 'log-1', limit: 25, includeSummary: false })

    expect(latestWhereCondition()).toMatchObject({
      type: 'and',
      conditions: [{ type: 'eq', left: 'usageLog.userId', right: 'user-1' }, { type: 'or' }],
    })
  })

  it('trusts a caller-supplied cursor timestamp without a lookup', async () => {
    await getUserUsageLogs('user-1', {
      cursor: 'log-1',
      cursorCreatedAt: new Date('2026-07-01T00:00:00Z'),
      limit: 25,
      includeSummary: false,
    })

    expect(latestWhereCondition()).toMatchObject({
      type: 'and',
      conditions: [{ type: 'eq', left: 'usageLog.userId', right: 'user-1' }, { type: 'or' }],
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(26)
  })

  it('keeps personal queries actor-scoped with an optional workspace filter', async () => {
    await getUserUsageLogs('user-1', {
      workspaceId: 'workspace-1',
      limit: 25,
      includeSummary: false,
    })

    expect(latestWhereCondition()).toMatchObject({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'usageLog.userId', right: 'user-1' },
        { type: 'eq', left: 'usageLog.workspaceId', right: 'workspace-1' },
      ],
    })
  })
})

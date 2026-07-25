import { createHash } from 'node:crypto'
import { db, dbReplica } from '@sim/db'
import { usageLog, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { apportionCredits } from '@/lib/billing/credits/conversion'
import { isOrgScopedSubscription } from '@/lib/billing/subscriptions/utils'
import type { DbClient, DbOrTx } from '@/lib/db/types'

const logger = createLogger('UsageLog')

/**
 * Usage log category types
 */
export type UsageLogCategory = 'model' | 'fixed' | 'tool'

/**
 * Usage log source types
 */
export type UsageLogSource =
  | 'workflow'
  | 'wand'
  | 'copilot'
  | 'workspace-chat'
  | 'mcp_copilot'
  | 'mothership_block'
  | 'knowledge-base'
  | 'voice-input'
  | 'enrichment'

/**
 * usage_log sources that make up the "copilot" cost breakdown shown in billing
 * summaries: the copilot agent, mothership/workspace chat, MCP copilot, and
 * mothership blocks. Mirrors the source set billed via /api/billing/update-cost.
 */
export const COPILOT_USAGE_SOURCES: UsageLogSource[] = [
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
]

/**
 * Metadata for 'model' category charges
 */
export interface ModelUsageMetadata {
  inputTokens: number
  outputTokens: number
  toolCost?: number
}

/**
 * Union type for all usage log metadata types
 */
export type UsageLogMetadata = ModelUsageMetadata | Record<string, unknown> | null

export type BillingEntityType = 'user' | 'organization'

export interface BillingEntity {
  type: BillingEntityType
  id: string
}

/**
 * A single usage entry to be recorded in the usage_log table.
 */
interface UsageEntry {
  category: UsageLogCategory
  source: UsageLogSource
  description: string
  cost: number
  eventKey?: string
  sourceReference?: string
  metadata?: UsageLogMetadata
}

interface RecordUsageBaseParams {
  /** Actor recorded in usage_log.userId. */
  userId: string
  /** One or more usage_log entries to record. Total cost is derived from these. */
  entries: UsageEntry[]
  /** Workspace context */
  workspaceId?: string
  /** Workflow context */
  workflowId?: string
  /** Execution context */
  executionId?: string
}

/**
 * Parameters for the central recordUsage function.
 * This is the single entry point for all billing mutations.
 *
 * Callers that pass `tx` (e.g. the per-execution advisory-lock reconciliation
 * in the workflow completion path) must pre-resolve the billing context before
 * opening the transaction: resolving it inside would run the subscription
 * lookups on the global pool while the tx already holds a pooled connection,
 * starving the pool under load (see recordCumulativeUsage for the history).
 */
export type RecordUsageParams = RecordUsageBaseParams &
  (
    | {
        /** Transaction the ledger INSERT participates in. */
        tx: DbOrTx
        /** Billing entity scope, resolved before the transaction opened. */
        billingEntity: BillingEntity
        /** Billing period bounds, resolved before the transaction opened. */
        billingPeriod: { start: Date; end: Date }
      }
    | {
        tx?: undefined
        /** Billing entity scope, resolved by caller when already known. */
        billingEntity?: BillingEntity
        /** Billing period bounds, resolved by caller when already known. */
        billingPeriod?: { start: Date; end: Date }
      }
  )

export function stableEventKey(parts: Record<string, unknown>): string {
  const payload = Object.keys(parts)
    .sort()
    .map((key) => `${key}:${String(parts[key] ?? '')}`)
    .join('|')
  return createHash('sha256').update(payload).digest('hex')
}

type ResolvedSubscription = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

export interface BillingContext {
  billingEntity: BillingEntity
  billingPeriod: { start: Date; end: Date }
}

/**
 * Derive an account-only billing entity and period from an already-resolved
 * subscription. Workspace-hosted callers must use `resolveBillingAttribution`
 * so the routed workspace, rather than the actor's subscriptions, selects the
 * payer.
 */
export function deriveBillingContext(
  userId: string,
  subscription: ResolvedSubscription
): BillingContext {
  const billingEntity: BillingEntity =
    subscription && isOrgScopedSubscription(subscription, userId)
      ? { type: 'organization', id: subscription.referenceId }
      : { type: 'user', id: userId }

  const billingPeriod =
    subscription?.periodStart && subscription.periodEnd
      ? { start: subscription.periodStart, end: subscription.periodEnd }
      : defaultBillingPeriod()

  return { billingEntity, billingPeriod }
}

async function resolveBillingContext(
  userId: string,
  billingEntity?: BillingEntity,
  billingPeriod?: { start: Date; end: Date }
): Promise<BillingContext> {
  if (billingEntity && billingPeriod) {
    return { billingEntity, billingPeriod }
  }

  const subscription = await getHighestPrioritySubscription(userId)
  const derived = deriveBillingContext(userId, subscription)
  return {
    billingEntity: billingEntity ?? derived.billingEntity,
    billingPeriod: billingPeriod ?? derived.billingPeriod,
  }
}

/**
 * Returns post-cutover usage for an attributed billing entity/period.
 * Legacy pre-cutover usage remains in userStats as a baseline until reset.
 */
export async function getBillingPeriodUsageCost(
  billingEntity: BillingEntity,
  billingPeriod: { start: Date; end: Date },
  source?: UsageLogSource | UsageLogSource[],
  executor: DbClient = db
): Promise<number> {
  const conditions = [
    eq(usageLog.billingEntityType, billingEntity.type),
    eq(usageLog.billingEntityId, billingEntity.id),
    eq(usageLog.billingPeriodStart, billingPeriod.start),
    eq(usageLog.billingPeriodEnd, billingPeriod.end),
  ]
  if (source) {
    conditions.push(
      Array.isArray(source) ? inArray(usageLog.source, source) : eq(usageLog.source, source)
    )
  }

  const [row] = await executor
    .select({
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(and(...conditions))

  return Number.parseFloat(row?.cost ?? '0')
}

export async function getBillingPeriodUsageCostByUser(
  billingEntity: BillingEntity,
  billingPeriod: { start: Date; end: Date },
  source?: UsageLogSource | UsageLogSource[],
  executor: DbClient = db
): Promise<Map<string, number>> {
  const conditions = [
    eq(usageLog.billingEntityType, billingEntity.type),
    eq(usageLog.billingEntityId, billingEntity.id),
    eq(usageLog.billingPeriodStart, billingPeriod.start),
    eq(usageLog.billingPeriodEnd, billingPeriod.end),
  ]
  if (source) {
    conditions.push(
      Array.isArray(source) ? inArray(usageLog.source, source) : eq(usageLog.source, source)
    )
  }

  const rows = await executor
    .select({
      userId: usageLog.userId,
      cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)`,
    })
    .from(usageLog)
    .where(and(...conditions))
    .groupBy(usageLog.userId)

  return new Map(rows.map((row) => [row.userId, Number.parseFloat(row.cost ?? '0')]))
}

/**
 * Records usage as append-only billing events.
 *
 * This intentionally avoids per-event userStats updates: userStats is retained
 * as the pre-cutover period baseline and for low-frequency billing trackers,
 * but usage writes no longer contend on the user_stats row.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  // The usage ledger is written regardless of BILLING_ENABLED so it is the
  // single, universal source of truth for cost (including self-hosted, where
  // it powers the logs-page cost display). Billing *enforcement* (Stripe /
  // overage) is gated separately by callers, not here.
  const {
    userId,
    entries,
    workspaceId,
    workflowId,
    executionId,
    billingEntity,
    billingPeriod,
    tx,
  } = params

  const validEntries = entries.filter((e) => e.cost > 0)

  if (validEntries.length === 0) {
    return
  }

  if (workspaceId && (!billingEntity || !billingPeriod)) {
    throw new Error('Workspace usage requires an explicit billing entity and billing period')
  }

  const context = await resolveBillingContext(userId, billingEntity, billingPeriod)

  const insertedRows = await (tx ?? db)
    .insert(usageLog)
    .values(
      validEntries.map((entry, index) => {
        const sourceReference =
          entry.sourceReference ??
          [executionId, workflowId, workspaceId, entry.source, entry.description, index]
            .filter((part) => part !== undefined && part !== null && part !== '')
            .join(':')
        const eventKey =
          entry.eventKey ??
          stableEventKey({
            userId,
            source: entry.source,
            category: entry.category,
            description: entry.description,
            sourceReference,
            executionId,
            workflowId,
            workspaceId,
            index,
          })

        return {
          id: generateId(),
          userId,
          category: entry.category,
          source: entry.source,
          description: entry.description,
          metadata: entry.metadata ?? null,
          cost: entry.cost.toString(),
          eventKey,
          billingEntityType: context.billingEntity.type,
          billingEntityId: context.billingEntity.id,
          billingPeriodStart: context.billingPeriod.start,
          billingPeriodEnd: context.billingPeriod.end,
          workspaceId: workspaceId ?? null,
          workflowId: workflowId ?? null,
          executionId: executionId ?? null,
        }
      })
    )
    .onConflictDoNothing({
      target: usageLog.eventKey,
      where: sql`${usageLog.eventKey} IS NOT NULL`,
    })
    .returning({ cost: usageLog.cost })

  const insertedCost = insertedRows.reduce((sum, row) => sum + Number.parseFloat(row.cost), 0)

  if (insertedRows.length < validEntries.length) {
    logger.debug('Skipped duplicate usage events', {
      userId,
      attemptedEntries: validEntries.length,
      insertedEntries: insertedRows.length,
    })
  }

  logger.debug('Recorded usage', {
    userId,
    totalCost: insertedCost,
    entryCount: validEntries.length,
    sources: [...new Set(validEntries.map((e) => e.source))],
  })
}

/**
 * Floating-point tolerance for cumulative cost comparison. Costs are dollars;
 * a sub-microcent difference is treated as "no change" so a DB round-trip
 * (decimal string -> float) can't manufacture a spurious top-up.
 */
export const CUMULATIVE_COST_EPSILON = 1e-9

/**
 * Decide whether an incoming CUMULATIVE cost for a request should bill, given
 * what has already been recorded for it.
 *
 * Billing is a monotonic top-up: only a strictly-higher cumulative bills, and
 * it bills just the delta above what's recorded; a same-or-lower cumulative is
 * a no-op. This is the core invariant that makes repeated flushes of a single
 * request converge to the true total exactly once — a partial mid-loop flush
 * (e.g. after a provider error), the recovered terminal flush, and abort-race
 * duplicates all reconcile to the maximum cumulative with no under- or
 * over-billing, independent of arrival order.
 */
export function resolveCumulativeTopUp(
  recordedCost: number,
  incomingCost: number
): { shouldBill: boolean; delta: number; newTotal: number } {
  if (incomingCost <= recordedCost + CUMULATIVE_COST_EPSILON) {
    return { shouldBill: false, delta: 0, newTotal: recordedCost }
  }
  return { shouldBill: true, delta: incomingCost - recordedCost, newTotal: incomingCost }
}

export interface RecordCumulativeUsageParams {
  /** Actor recorded in usage_log.userId. */
  userId: string
  workspaceId?: string
  /** Exact workspace payer, required whenever workspaceId is present. */
  billingEntity?: BillingEntity
  /** Exact workspace payer period, required whenever workspaceId is present. */
  billingPeriod?: { start: Date; end: Date }
  source: UsageLogSource
  /** Model name, stored as the row description. */
  model: string
  /** The request's CUMULATIVE cost so far (not a per-leg delta). */
  cost: number
  /** Stable per-request key; the single ledger row is keyed on this. */
  eventKey: string
  metadata?: UsageLogMetadata
}

export interface RecordCumulativeUsageResult {
  /** True when a new (delta) charge was recorded for this flush. */
  billed: boolean
  /** Amount newly charged by this flush (0 on a duplicate/lower flush). */
  delta: number
  /** The request's recorded cumulative cost after this flush. */
  total: number
}

export type CumulativeUsageContextField =
  | 'actor'
  | 'workspace'
  | 'billing entity'
  | 'billing period'

export class CumulativeUsageContextMismatchError extends Error {
  constructor(
    readonly eventKey: string,
    readonly mismatchedFields: readonly CumulativeUsageContextField[]
  ) {
    super(
      `Cumulative usage event "${eventKey}" is already bound to a different billing context (${mismatchedFields.join(', ')})`
    )
    this.name = 'CumulativeUsageContextMismatchError'
  }
}

interface CumulativeUsageLedgerBinding {
  userId: string
  workspaceId: string | null
  billingEntityType: BillingEntityType | null
  billingEntityId: string | null
  billingPeriodStart: Date | null
  billingPeriodEnd: Date | null
}

function assertCumulativeUsageLedgerBinding(
  existing: CumulativeUsageLedgerBinding,
  expected: {
    userId: string
    workspaceId?: string
    billingContext: BillingContext
    eventKey: string
  }
): void {
  const mismatchedFields: CumulativeUsageContextField[] = []
  if (existing.userId !== expected.userId) {
    mismatchedFields.push('actor')
  }
  if (existing.workspaceId !== (expected.workspaceId ?? null)) {
    mismatchedFields.push('workspace')
  }
  if (
    existing.billingEntityType !== expected.billingContext.billingEntity.type ||
    existing.billingEntityId !== expected.billingContext.billingEntity.id
  ) {
    mismatchedFields.push('billing entity')
  }
  if (
    existing.billingPeriodStart?.getTime() !==
      expected.billingContext.billingPeriod.start.getTime() ||
    existing.billingPeriodEnd?.getTime() !== expected.billingContext.billingPeriod.end.getTime()
  ) {
    mismatchedFields.push('billing period')
  }

  if (mismatchedFields.length > 0) {
    throw new CumulativeUsageContextMismatchError(expected.eventKey, mismatchedFields)
  }
}

/**
 * Bounds the wait for the per-event-key advisory lock (and any row/index lock
 * waits inside the critical section). The Go mothership gives each UpdateCost
 * POST a 5s deadline, retries 3x with backoff, then dead-letters the charge
 * keyed on the same idempotency key — so a stuck lock holder must surface as
 * a fast, retryable failure (SQLSTATE 55P03) within that budget rather than
 * an unbounded wait that pins pooled connections.
 */
const CUMULATIVE_FLUSH_LOCK_TIMEOUT_MS = 3_000

/**
 * Record a request's CUMULATIVE cost idempotently with monotonic top-up.
 *
 * Keeps exactly ONE usage_log row per `eventKey` holding the MAX cumulative
 * cost ever submitted for the request, billing only the incremental delta on
 * each flush. A per-key transactional advisory lock serializes concurrent
 * flushes so the read-then-write — including the first insert — is race-free
 * (no two flushes can both believe they are first and clobber each other).
 * An existing row must match the incoming actor, workspace, payer, and billing
 * period before either a duplicate no-op or a top-up is accepted.
 * The billing context is resolved BEFORE the transaction and the lock wait is
 * bounded by `lock_timeout`, keeping the critical section to one SELECT plus
 * one INSERT/UPDATE on a single pooled connection.
 *
 * Because every leg flushes its cumulative and this converges to the max,
 * there is no under-billing if the request recovers after a partial flush, no
 * over-billing from duplicate/abort-race flushes, and no lost billing if the
 * process dies between legs — each leg's cost is durably recorded as it lands.
 */
export async function recordCumulativeUsage(
  params: RecordCumulativeUsageParams
): Promise<RecordCumulativeUsageResult> {
  const {
    userId,
    workspaceId,
    billingEntity,
    billingPeriod,
    source,
    model,
    cost,
    eventKey,
    metadata,
  } = params

  if (workspaceId && (!billingEntity || !billingPeriod)) {
    throw new Error('Workspace usage requires an explicit billing entity and billing period')
  }

  const billingContext = await resolveBillingContext(userId, billingEntity, billingPeriod)

  return db.transaction(async (tx) => {
    // Serialize all flushes for this request (lock auto-releases at tx end),
    // with a bounded wait so a pathological holder fails this flush fast and
    // lets the caller retry instead of hanging the connection.
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${CUMULATIVE_FLUSH_LOCK_TIMEOUT_MS}ms`}, true)`
    )
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventKey}, 0))`)

    const [existing] = await tx
      .select({
        id: usageLog.id,
        cost: usageLog.cost,
        userId: usageLog.userId,
        workspaceId: usageLog.workspaceId,
        billingEntityType: usageLog.billingEntityType,
        billingEntityId: usageLog.billingEntityId,
        billingPeriodStart: usageLog.billingPeriodStart,
        billingPeriodEnd: usageLog.billingPeriodEnd,
      })
      .from(usageLog)
      .where(eq(usageLog.eventKey, eventKey))
      .limit(1)

    if (existing) {
      assertCumulativeUsageLedgerBinding(existing, {
        userId,
        workspaceId,
        billingContext,
        eventKey,
      })
    }

    const recorded = existing ? Number.parseFloat(existing.cost) : 0
    const { shouldBill, delta, newTotal } = resolveCumulativeTopUp(recorded, cost)

    if (!shouldBill) {
      return { billed: false, delta: 0, total: recorded }
    }

    if (existing) {
      // Top up the single row to the new (higher) cumulative; the
      // period total is SUM(usage_log.cost), so this lifts it by the delta.
      await tx
        .update(usageLog)
        .set({ cost: newTotal.toString(), metadata: metadata ?? null })
        .where(eq(usageLog.id, existing.id))
    } else {
      // First flush for this request: insert the canonical row with the
      // pre-resolved billing context. Runs in the same tx + advisory lock.
      await recordUsage({
        userId,
        workspaceId,
        tx,
        billingEntity: billingContext.billingEntity,
        billingPeriod: billingContext.billingPeriod,
        entries: [
          {
            category: 'model',
            source,
            description: model,
            cost: newTotal,
            eventKey,
            sourceReference: eventKey,
            ...(metadata ? { metadata } : {}),
          },
        ],
      })
    }

    return { billed: true, delta, total: newTotal }
  })
}

interface UsageLogFilter {
  source?: UsageLogSource
  workspaceId?: string
  startDate?: Date
  endDate?: Date
}

function buildUsageLogConditions(userId: string, filter: UsageLogFilter) {
  const conditions = [eq(usageLog.userId, userId)]
  if (filter.source) conditions.push(eq(usageLog.source, filter.source))
  if (filter.workspaceId) conditions.push(eq(usageLog.workspaceId, filter.workspaceId))
  if (filter.startDate) conditions.push(gte(usageLog.createdAt, filter.startDate))
  if (filter.endDate) conditions.push(lte(usageLog.createdAt, filter.endDate))
  return conditions
}

/**
 * Apportions credits across every log matching the filter (not just one
 * page), so a row's `creditCost` is identical everywhere it's shown — the
 * paginated list and the CSV export both call this rather than each
 * apportioning their own subset, which would let the same row disagree
 * between the two (or between pages of the same list) since apportionment
 * depends on the complete set's total.
 */
export async function getUsageCreditsByLogId(
  userId: string,
  filter: UsageLogFilter
): Promise<Record<string, number>> {
  const rows = await dbReplica
    .select({ id: usageLog.id, cost: usageLog.cost })
    .from(usageLog)
    .where(and(...buildUsageLogConditions(userId, filter)))
    .orderBy(desc(usageLog.createdAt), desc(usageLog.id))

  return apportionCredits(
    rows.map((row) => ({ key: row.id, dollars: Number.parseFloat(row.cost) }))
  )
}

/**
 * Options for querying usage logs
 */
export interface GetUsageLogsOptions {
  /** Filter by source */
  source?: UsageLogSource
  /** Filter by workspace */
  workspaceId?: string
  /** Start date (inclusive) */
  startDate?: Date
  /** End date (inclusive) */
  endDate?: Date
  /** Maximum number of results */
  limit?: number
  /** Cursor for pagination (log ID) */
  cursor?: string
  /**
   * The cursor row's `createdAt`, when the caller already has it (e.g. a
   * multi-page export loop holding the previous page's rows in memory).
   * Skips the row lookup that would otherwise resolve it from `cursor`.
   */
  cursorCreatedAt?: Date
  /**
   * Whether to compute the full-filter `summary` aggregate (default `true`).
   * A cursor-paginated caller collecting every page (e.g. a CSV export) only
   * needs `logs` from each page and would otherwise pay for the same
   * cursor-independent `SUM`/`GROUP BY` scan once per page for a result it
   * never reads — set `false` to skip it.
   */
  includeSummary?: boolean
}

/**
 * Usage log entry returned from queries
 */
interface UsageLogEntry {
  id: string
  createdAt: string
  category: UsageLogCategory
  source: UsageLogSource
  description: string
  metadata?: UsageLogMetadata
  cost: number
  workspaceId?: string
  workflowId?: string
  /** Name of the referenced workflow, when `workflowId` resolves to one. */
  workflowName?: string
  executionId?: string
}

/**
 * Result from getUserUsageLogs
 */
export interface UsageLogsResult {
  logs: UsageLogEntry[]
  /** `{ totalCost: 0, bySource: {} }` when `includeSummary` is `false`. */
  summary: {
    totalCost: number
    bySource: Record<string, number>
  }
  pagination: {
    nextCursor?: string
    hasMore: boolean
  }
}

/**
 * Get usage logs for a user with optional filtering and pagination
 */
export async function getUserUsageLogs(
  userId: string,
  options: GetUsageLogsOptions = {}
): Promise<UsageLogsResult> {
  const {
    source,
    workspaceId,
    startDate,
    endDate,
    limit = 50,
    cursor,
    cursorCreatedAt,
    includeSummary = true,
  } = options

  try {
    const conditions = buildUsageLogConditions(userId, { source, workspaceId, startDate, endDate })

    if (cursor) {
      let resolvedCursorCreatedAt = cursorCreatedAt

      if (!resolvedCursorCreatedAt) {
        // Cursor resolution stays on the primary: the page itself reads a
        // load-balanced replica, and a laggier sibling replica missing the
        // cursor row would silently restart pagination from page 1.
        const cursorLog = await db
          .select({ createdAt: usageLog.createdAt })
          .from(usageLog)
          .where(eq(usageLog.id, cursor))
          .limit(1)
        resolvedCursorCreatedAt = cursorLog[0]?.createdAt
      }

      if (resolvedCursorCreatedAt) {
        const cursorCondition = or(
          lt(usageLog.createdAt, resolvedCursorCreatedAt),
          and(eq(usageLog.createdAt, resolvedCursorCreatedAt), lt(usageLog.id, cursor))
        )
        if (cursorCondition) conditions.push(cursorCondition)
      }
    }

    const logs = await dbReplica
      .select({
        id: usageLog.id,
        createdAt: usageLog.createdAt,
        category: usageLog.category,
        source: usageLog.source,
        description: usageLog.description,
        metadata: usageLog.metadata,
        cost: usageLog.cost,
        workspaceId: usageLog.workspaceId,
        workflowId: usageLog.workflowId,
        workflowName: workflow.name,
        executionId: usageLog.executionId,
      })
      .from(usageLog)
      .leftJoin(workflow, eq(usageLog.workflowId, workflow.id))
      .where(and(...conditions))
      .orderBy(desc(usageLog.createdAt), desc(usageLog.id))
      .limit(limit + 1)

    const hasMore = logs.length > limit
    const resultLogs = hasMore ? logs.slice(0, limit) : logs

    const transformedLogs: UsageLogEntry[] = resultLogs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      category: log.category as UsageLogCategory,
      source: log.source as UsageLogSource,
      description: log.description,
      ...(log.metadata ? { metadata: log.metadata as UsageLogMetadata } : {}),
      cost: Number.parseFloat(log.cost),
      ...(log.workspaceId ? { workspaceId: log.workspaceId } : {}),
      ...(log.workflowId ? { workflowId: log.workflowId } : {}),
      ...(log.workflowName ? { workflowName: log.workflowName } : {}),
      ...(log.executionId ? { executionId: log.executionId } : {}),
    }))

    const bySource: Record<string, number> = {}
    let totalCost = 0

    if (includeSummary) {
      const summaryConditions = buildUsageLogConditions(userId, {
        source,
        workspaceId,
        startDate,
        endDate,
      })

      const summaryResult = await dbReplica
        .select({
          source: usageLog.source,
          totalCost: sql<string>`SUM(${usageLog.cost})`,
        })
        .from(usageLog)
        .where(and(...summaryConditions))
        .groupBy(usageLog.source)

      for (const row of summaryResult) {
        const sourceCost = Number.parseFloat(row.totalCost || '0')
        bySource[row.source] = sourceCost
        totalCost += sourceCost
      }
    }

    return {
      logs: transformedLogs,
      summary: {
        totalCost,
        bySource,
      },
      pagination: {
        nextCursor:
          hasMore && resultLogs.length > 0 ? resultLogs[resultLogs.length - 1].id : undefined,
        hasMore,
      },
    }
  } catch (error) {
    logger.error('Failed to get usage logs', {
      error: toError(error).message,
      userId,
      options,
    })
    throw error
  }
}

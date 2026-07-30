import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

const logger = createLogger('BackfillPausedBillingAttribution')

export const PAUSED_BILLING_ATTRIBUTION_BATCH_SIZE = 50
export const MAX_PAUSED_BILLING_SNAPSHOT_BYTES = 16 * 1024 * 1024

const ACTIVE_PAUSE_STATUSES = ['paused', 'partially_resumed', 'cancelling'] as const
const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'past_due'] as const
const OPEN_BILLING_PERIOD_START = '1970-01-01T00:00:00.000Z'
const OPEN_BILLING_PERIOD_END = '9999-12-31T00:00:00.000Z'

interface BillingEntitySnapshot {
  readonly type: 'organization' | 'user'
  readonly id: string
}

interface PayerSubscriptionSnapshot {
  readonly id: string
  readonly referenceId: string
  readonly plan: string
  readonly status: string | null
  readonly seats: number | null
  readonly periodStart: string | null
  readonly periodEnd: string | null
}

export interface BillingAttributionSnapshot {
  readonly actorUserId: string
  readonly workspaceId: string
  readonly organizationId: string | null
  readonly billedAccountUserId: string
  readonly billingEntity: Readonly<BillingEntitySnapshot>
  readonly billingPeriod: Readonly<{ start: string; end: string }>
  readonly payerSubscription: Readonly<PayerSubscriptionSnapshot> | null
}

export interface PausedExecutionCandidate {
  executionId: string
  executionSnapshot: unknown
  id: string
  snapshotBytes: number
  workflowId: string
}

export interface SubscriptionCandidate {
  id: string
  periodEnd: unknown
  periodStart: unknown
  plan: string
  referenceId: string
  seats: number | null
  status: string | null
}

interface WorkspacePayer {
  billedAccountUserId: string
  organizationId: string | null
}

interface ConditionalAttributionUpdate {
  expectedExecutionSnapshot: unknown
  id: string
  nextExecutionSnapshot: unknown
}

export interface PausedBillingAttributionStore {
  listActiveIds(afterId: string | undefined, limit: number): Promise<Array<{ id: string }>>
  loadActive(id: string): Promise<PausedExecutionCandidate | null>
  loadWorkspacePayer(workspaceId: string): Promise<WorkspacePayer | null>
  loadOrganizationSubscription(organizationId: string): Promise<SubscriptionCandidate | null>
  listPersonalSubscriptions(userId: string): Promise<SubscriptionCandidate[]>
  writeAttribution(update: ConditionalAttributionUpdate): Promise<boolean>
}

export interface PausedBillingAttributionBackfillSummary {
  batches: number
  conflicted: number
  disappeared: number
  existing: number
  malformed: number
  migrated: number
  scanned: number
}

interface ParsedMissingAttribution {
  actorUserId: string
  executionSnapshot: Record<string, unknown>
  metadata: Record<string, unknown>
  snapshot: Record<string, unknown>
  state: 'missing'
  workspaceId: string
}

interface ParsedExistingAttribution {
  state: 'existing'
}

type ParsedPausedSnapshot = ParsedMissingAttribution | ParsedExistingAttribution

class LegacyPausedBillingAttributionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LegacyPausedBillingAttributionError'
  }
}

function legacyError(message: string): never {
  throw new LegacyPausedBillingAttributionError(message)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseSnapshotDate(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    return legacyError(`Billing attribution ${field} must be a non-empty ISO date string`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return legacyError(`Billing attribution ${field} is not a valid ISO date string`)
  }
  return date.toISOString()
}

function parseDatabaseTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return legacyError(`Subscription ${field} is not a valid date`)
    }
    return value.toISOString()
  }
  if (typeof value !== 'string') {
    return legacyError(`Subscription ${field} is not a database timestamp`)
  }

  const date = new Date(`${value}+0000`)
  if (!Number.isFinite(date.getTime())) {
    return legacyError(`Subscription ${field} is not a valid date`)
  }
  return date.toISOString()
}

/**
 * Frozen copy of the canonical app boundary validator used by the cutover
 * release. Keeping it local makes this historical migration replay-stable.
 */
export function assertFrozenBillingAttributionSnapshot(value: unknown): BillingAttributionSnapshot {
  if (!isRecordLike(value)) {
    return legacyError('Billing attribution snapshot must be an object')
  }
  if (
    !isNonEmptyString(value.actorUserId) ||
    !isNonEmptyString(value.workspaceId) ||
    !isNonEmptyString(value.billedAccountUserId)
  ) {
    return legacyError(
      'Billing attribution snapshot is missing actor, workspace, or billed account'
    )
  }
  if (value.organizationId !== null && !isNonEmptyString(value.organizationId)) {
    return legacyError('Billing attribution organization must be a non-empty string or null')
  }
  const organizationId = value.organizationId

  if (!isRecordLike(value.billingEntity)) {
    return legacyError('Billing attribution snapshot is missing its billing entity')
  }
  const entityType = value.billingEntity.type
  const entityId = value.billingEntity.id
  if ((entityType !== 'user' && entityType !== 'organization') || !isNonEmptyString(entityId)) {
    return legacyError('Billing attribution snapshot has an invalid billing entity')
  }
  if (
    (entityType === 'organization' && (organizationId === null || entityId !== organizationId)) ||
    (entityType === 'user' && (organizationId !== null || entityId !== value.billedAccountUserId))
  ) {
    return legacyError('Billing attribution payer fields are inconsistent')
  }

  if (!isRecordLike(value.billingPeriod)) {
    return legacyError('Billing attribution snapshot is missing its billing period')
  }
  const periodStart = parseSnapshotDate(value.billingPeriod.start, 'billingPeriod.start')
  const periodEnd = parseSnapshotDate(value.billingPeriod.end, 'billingPeriod.end')
  if (new Date(periodEnd) <= new Date(periodStart)) {
    return legacyError('Billing attribution billing period must end after it starts')
  }

  let payerSubscription: PayerSubscriptionSnapshot | null = null
  if (value.payerSubscription !== null) {
    if (!isRecordLike(value.payerSubscription)) {
      return legacyError('Billing attribution payer subscription must be an object or null')
    }
    const subscription = value.payerSubscription
    if (
      !isNonEmptyString(subscription.id) ||
      !isNonEmptyString(subscription.referenceId) ||
      !isNonEmptyString(subscription.plan) ||
      (subscription.status !== null && typeof subscription.status !== 'string') ||
      (subscription.seats !== null &&
        (typeof subscription.seats !== 'number' ||
          !Number.isFinite(subscription.seats) ||
          subscription.seats < 0))
    ) {
      return legacyError('Billing attribution payer subscription is invalid')
    }

    const subscriptionStart =
      subscription.periodStart === null
        ? null
        : parseSnapshotDate(subscription.periodStart, 'payerSubscription.periodStart')
    const subscriptionEnd =
      subscription.periodEnd === null
        ? null
        : parseSnapshotDate(subscription.periodEnd, 'payerSubscription.periodEnd')
    if (
      subscriptionStart !== null &&
      subscriptionEnd !== null &&
      new Date(subscriptionEnd) <= new Date(subscriptionStart)
    ) {
      return legacyError('Billing attribution subscription period must end after it starts')
    }
    if (subscription.referenceId !== entityId) {
      return legacyError('Billing attribution subscription does not belong to its billing entity')
    }

    payerSubscription = {
      id: subscription.id,
      referenceId: subscription.referenceId,
      plan: subscription.plan,
      status: subscription.status,
      seats: subscription.seats,
      periodStart: subscriptionStart,
      periodEnd: subscriptionEnd,
    }
  }

  return {
    actorUserId: value.actorUserId,
    workspaceId: value.workspaceId,
    organizationId,
    billedAccountUserId: value.billedAccountUserId,
    billingEntity: { type: entityType, id: entityId },
    billingPeriod: { start: periodStart, end: periodEnd },
    payerSubscription,
  }
}

function serializeSubscription(
  subscription: SubscriptionCandidate | null,
  expectedReferenceId: string
): PayerSubscriptionSnapshot | null {
  if (!subscription) return null
  if (
    !isNonEmptyString(subscription.id) ||
    !isNonEmptyString(subscription.referenceId) ||
    !isNonEmptyString(subscription.plan) ||
    !ENTITLED_SUBSCRIPTION_STATUSES.includes(
      subscription.status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number]
    ) ||
    (subscription.seats !== null &&
      (!Number.isFinite(subscription.seats) || subscription.seats < 0))
  ) {
    return legacyError(`Subscription ${subscription.id || '<missing>'} is invalid`)
  }
  if (subscription.referenceId !== expectedReferenceId) {
    return legacyError(
      `Subscription ${subscription.id} does not belong to workspace payer ${expectedReferenceId}`
    )
  }

  const periodStart = parseDatabaseTimestamp(subscription.periodStart, 'period_start')
  const periodEnd = parseDatabaseTimestamp(subscription.periodEnd, 'period_end')
  if (periodStart !== null && periodEnd !== null && new Date(periodEnd) <= new Date(periodStart)) {
    return legacyError(`Subscription ${subscription.id} has an invalid billing period`)
  }

  return {
    id: subscription.id,
    referenceId: subscription.referenceId,
    plan: subscription.plan,
    status: subscription.status,
    seats: subscription.seats,
    periodStart,
    periodEnd,
  }
}

function personalPlanPriority(plan: string): number {
  if (plan === 'enterprise') return 3
  if (plan === 'team' || plan.startsWith('team_')) return 2
  if (plan === 'pro' || plan.startsWith('pro_')) return 1
  return 0
}

/**
 * Mirrors the canonical Enterprise → Team → Pro selection. The app query has
 * no within-tier ordering, so multiple rows at the winning tier are skipped
 * rather than assigning a payer nondeterministically.
 */
export function selectFrozenPersonalSubscription(
  subscriptions: readonly SubscriptionCandidate[]
): SubscriptionCandidate | null {
  let winningPriority = 0
  let matches: SubscriptionCandidate[] = []

  for (const subscription of subscriptions) {
    if (
      !ENTITLED_SUBSCRIPTION_STATUSES.includes(
        subscription.status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number]
      )
    ) {
      continue
    }
    const priority = personalPlanPriority(subscription.plan)
    if (priority > winningPriority) {
      winningPriority = priority
      matches = [subscription]
    } else if (priority > 0 && priority === winningPriority) {
      matches.push(subscription)
    }
  }

  if (matches.length > 1) {
    return legacyError(
      `Personal payer has ${matches.length} subscriptions at the same highest-priority tier`
    )
  }
  return matches[0] ?? null
}

function parsePausedSnapshot(candidate: PausedExecutionCandidate): ParsedPausedSnapshot {
  if (!isRecordLike(candidate.executionSnapshot)) {
    return legacyError('Paused execution snapshot envelope must be an object')
  }
  const executionSnapshot = candidate.executionSnapshot
  if (
    typeof executionSnapshot.snapshot !== 'string' ||
    !Array.isArray(executionSnapshot.triggerIds) ||
    !executionSnapshot.triggerIds.every((value) => typeof value === 'string')
  ) {
    return legacyError('Paused execution snapshot envelope is invalid')
  }
  if (Buffer.byteLength(executionSnapshot.snapshot, 'utf8') > MAX_PAUSED_BILLING_SNAPSHOT_BYTES) {
    return legacyError('Paused execution inner snapshot exceeds the migration byte limit')
  }

  let snapshotValue: unknown
  try {
    snapshotValue = JSON.parse(executionSnapshot.snapshot)
  } catch {
    return legacyError('Paused execution snapshot JSON is malformed')
  }
  if (!isRecordLike(snapshotValue) || !isRecordLike(snapshotValue.metadata)) {
    return legacyError('Paused execution snapshot metadata is invalid')
  }
  const metadata = snapshotValue.metadata
  if (
    !isNonEmptyString(metadata.userId) ||
    !isNonEmptyString(metadata.workspaceId) ||
    !isNonEmptyString(metadata.workflowId) ||
    !isNonEmptyString(metadata.executionId)
  ) {
    return legacyError('Paused execution snapshot is missing actor or execution bindings')
  }
  if (
    metadata.workflowId !== candidate.workflowId ||
    metadata.executionId !== candidate.executionId
  ) {
    return legacyError('Paused execution snapshot does not match its durable row')
  }

  if (Object.hasOwn(metadata, 'billingAttribution')) {
    const attribution = assertFrozenBillingAttributionSnapshot(metadata.billingAttribution)
    if (
      attribution.actorUserId !== metadata.userId ||
      attribution.workspaceId !== metadata.workspaceId
    ) {
      return legacyError(
        'Paused execution attribution does not match its persisted actor and workspace'
      )
    }
    return { state: 'existing' }
  }

  return {
    actorUserId: metadata.userId,
    executionSnapshot,
    metadata,
    snapshot: snapshotValue,
    state: 'missing',
    workspaceId: metadata.workspaceId,
  }
}

async function resolveFrozenAttribution(
  parsed: ParsedMissingAttribution,
  store: PausedBillingAttributionStore
): Promise<BillingAttributionSnapshot> {
  const payer = await store.loadWorkspacePayer(parsed.workspaceId)
  if (!payer || !isNonEmptyString(payer.billedAccountUserId)) {
    return legacyError(`Unable to resolve billing payer for workspace ${parsed.workspaceId}`)
  }
  if (payer.organizationId !== null && !isNonEmptyString(payer.organizationId)) {
    return legacyError(`Workspace ${parsed.workspaceId} has an invalid organization payer`)
  }

  const expectedReferenceId = payer.organizationId ?? payer.billedAccountUserId
  const subscription = payer.organizationId
    ? await store.loadOrganizationSubscription(payer.organizationId)
    : selectFrozenPersonalSubscription(
        await store.listPersonalSubscriptions(payer.billedAccountUserId)
      )
  const payerSubscription = serializeSubscription(subscription, expectedReferenceId)
  const billingPeriod =
    payerSubscription?.periodStart && payerSubscription.periodEnd
      ? { start: payerSubscription.periodStart, end: payerSubscription.periodEnd }
      : { start: OPEN_BILLING_PERIOD_START, end: OPEN_BILLING_PERIOD_END }
  const billingEntity: BillingEntitySnapshot = payer.organizationId
    ? { type: 'organization', id: payer.organizationId }
    : { type: 'user', id: payer.billedAccountUserId }

  return assertFrozenBillingAttributionSnapshot({
    actorUserId: parsed.actorUserId,
    workspaceId: parsed.workspaceId,
    organizationId: payer.organizationId,
    billedAccountUserId: payer.billedAccountUserId,
    billingEntity,
    billingPeriod,
    payerSubscription,
  })
}

function buildAttributedExecutionSnapshot(
  parsed: ParsedMissingAttribution,
  attribution: BillingAttributionSnapshot
): Record<string, unknown> {
  if (
    attribution.actorUserId !== parsed.actorUserId ||
    attribution.workspaceId !== parsed.workspaceId
  ) {
    return legacyError('Resolved attribution does not match the persisted paused snapshot')
  }

  const serializedSnapshot = JSON.stringify({
    ...parsed.snapshot,
    metadata: {
      ...parsed.metadata,
      billingAttribution: attribution,
    },
  })
  if (Buffer.byteLength(serializedSnapshot, 'utf8') > MAX_PAUSED_BILLING_SNAPSHOT_BYTES) {
    return legacyError('Attributed paused execution snapshot exceeds the migration byte limit')
  }

  const executionSnapshot = {
    ...parsed.executionSnapshot,
    snapshot: serializedSnapshot,
  }
  if (
    Buffer.byteLength(JSON.stringify(executionSnapshot), 'utf8') > MAX_PAUSED_BILLING_SNAPSHOT_BYTES
  ) {
    return legacyError('Attributed paused execution envelope exceeds the migration byte limit')
  }
  return executionSnapshot
}

function normalizeCount(value: number | string): number {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid paused execution snapshot byte count: ${String(value)}`)
  }
  return normalized
}

/**
 * Creates the SQL-backed adapter using only the migration runner's reserved
 * postgres client.
 */
export function createPausedBillingAttributionStore(sql: Sql): PausedBillingAttributionStore {
  return {
    async listActiveIds(afterId, limit) {
      if (afterId === undefined) {
        return sql<Array<{ id: string }>>`
          SELECT id
          FROM paused_executions
          WHERE status = ANY(${[...ACTIVE_PAUSE_STATUSES]}::text[])
          ORDER BY id ASC
          LIMIT ${limit}
        `
      }
      return sql<Array<{ id: string }>>`
        SELECT id
        FROM paused_executions
        WHERE status = ANY(${[...ACTIVE_PAUSE_STATUSES]}::text[])
          AND id > ${afterId}
        ORDER BY id ASC
        LIMIT ${limit}
      `
    },

    async loadActive(id) {
      const rows = await sql<
        Array<{
          execution_id: string
          execution_snapshot: unknown
          id: string
          snapshot_bytes: number | string
          workflow_id: string
        }>
      >`
        SELECT
          id,
          workflow_id,
          execution_id,
          octet_length(execution_snapshot::text) AS snapshot_bytes,
          CASE
            WHEN octet_length(execution_snapshot::text) <= ${MAX_PAUSED_BILLING_SNAPSHOT_BYTES}
            THEN execution_snapshot
            ELSE NULL::jsonb
          END AS execution_snapshot
        FROM paused_executions
        WHERE id = ${id}
          AND status = ANY(${[...ACTIVE_PAUSE_STATUSES]}::text[])
        LIMIT 1
      `
      const row = rows[0]
      if (!row) return null
      return {
        executionId: row.execution_id,
        executionSnapshot: row.execution_snapshot,
        id: row.id,
        snapshotBytes: normalizeCount(row.snapshot_bytes),
        workflowId: row.workflow_id,
      }
    },

    async loadWorkspacePayer(workspaceId) {
      const rows = await sql<
        Array<{ billed_account_user_id: string; organization_id: string | null }>
      >`
        SELECT billed_account_user_id, organization_id
        FROM workspace
        WHERE id = ${workspaceId}
        LIMIT 1
      `
      const row = rows[0]
      return row
        ? {
            billedAccountUserId: row.billed_account_user_id,
            organizationId: row.organization_id,
          }
        : null
    },

    async loadOrganizationSubscription(organizationId) {
      const rows = await sql<
        Array<{
          id: string
          period_end: string | null
          period_start: string | null
          plan: string
          reference_id: string
          seats: number | null
          status: string | null
        }>
      >`
        SELECT
          id,
          reference_id,
          plan,
          status,
          seats,
          period_start::text AS period_start,
          period_end::text AS period_end
        FROM subscription
        WHERE reference_id = ${organizationId}
          AND status = ANY(${[...ENTITLED_SUBSCRIPTION_STATUSES]}::text[])
        ORDER BY period_start DESC, id DESC
        LIMIT 1
      `
      const row = rows[0]
      return row
        ? {
            id: row.id,
            periodEnd: row.period_end,
            periodStart: row.period_start,
            plan: row.plan,
            referenceId: row.reference_id,
            seats: row.seats,
            status: row.status,
          }
        : null
    },

    async listPersonalSubscriptions(userId) {
      const rows = await sql<
        Array<{
          id: string
          period_end: string | null
          period_start: string | null
          plan: string
          reference_id: string
          seats: number | null
          status: string | null
        }>
      >`
        SELECT
          id,
          reference_id,
          plan,
          status,
          seats,
          period_start::text AS period_start,
          period_end::text AS period_end
        FROM subscription
        WHERE reference_id = ${userId}
          AND status = ANY(${[...ENTITLED_SUBSCRIPTION_STATUSES]}::text[])
      `
      return rows.map((row) => ({
        id: row.id,
        periodEnd: row.period_end,
        periodStart: row.period_start,
        plan: row.plan,
        referenceId: row.reference_id,
        seats: row.seats,
        status: row.status,
      }))
    },

    async writeAttribution({ expectedExecutionSnapshot, id, nextExecutionSnapshot }) {
      const rows = await sql<Array<{ id: string }>>`
        UPDATE paused_executions
        SET execution_snapshot = ${JSON.stringify(nextExecutionSnapshot)}::jsonb
        WHERE id = ${id}
          AND status = ANY(${[...ACTIVE_PAUSE_STATUSES]}::text[])
          AND execution_snapshot = ${JSON.stringify(expectedExecutionSnapshot)}::jsonb
        RETURNING id
      `
      if (rows.length > 1) {
        throw new Error(`Conditional paused execution update affected ${rows.length} rows`)
      }
      return rows.length === 1
    },
  }
}

function assertKeysetPage(
  rows: readonly { id: string }[],
  afterId: string | undefined,
  batchSize: number
): void {
  if (rows.length > batchSize) {
    throw new Error(`Paused execution store exceeded the ${batchSize}-row keyset bound`)
  }

  let previousId = afterId
  for (const row of rows) {
    if (!isNonEmptyString(row.id) || (previousId !== undefined && row.id <= previousId)) {
      throw new Error('Paused execution store returned a non-increasing keyset page')
    }
    previousId = row.id
  }
}

/**
 * Executes the bounded, sequential, replay-safe one-shot backfill.
 */
export async function runPausedBillingAttributionBackfill(
  store: PausedBillingAttributionStore,
  batchSize = PAUSED_BILLING_ATTRIBUTION_BATCH_SIZE
): Promise<PausedBillingAttributionBackfillSummary> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('Paused billing attribution batch size must be a positive integer')
  }

  const summary: PausedBillingAttributionBackfillSummary = {
    batches: 0,
    conflicted: 0,
    disappeared: 0,
    existing: 0,
    malformed: 0,
    migrated: 0,
    scanned: 0,
  }
  let afterId: string | undefined

  for (;;) {
    const rows = await store.listActiveIds(afterId, batchSize)
    assertKeysetPage(rows, afterId, batchSize)
    if (rows.length === 0) break
    summary.batches += 1

    for (const row of rows) {
      summary.scanned += 1
      try {
        const candidate = await store.loadActive(row.id)
        if (!candidate) {
          summary.disappeared += 1
          continue
        }
        if (candidate.snapshotBytes > MAX_PAUSED_BILLING_SNAPSHOT_BYTES) {
          legacyError(
            `Paused execution snapshot is ${candidate.snapshotBytes} bytes, above the migration limit`
          )
        }

        const parsed = parsePausedSnapshot(candidate)
        if (parsed.state === 'existing') {
          summary.existing += 1
          continue
        }
        const attribution = await resolveFrozenAttribution(parsed, store)
        const nextExecutionSnapshot = buildAttributedExecutionSnapshot(parsed, attribution)
        const migrated = await store.writeAttribution({
          expectedExecutionSnapshot: parsed.executionSnapshot,
          id: candidate.id,
          nextExecutionSnapshot,
        })
        if (migrated) {
          summary.migrated += 1
        } else {
          summary.conflicted += 1
        }
      } catch (error) {
        if (!(error instanceof LegacyPausedBillingAttributionError)) throw error
        summary.malformed += 1
        logger.warn('Skipping malformed legacy paused execution during attribution backfill', {
          error: getErrorMessage(error),
          pausedExecutionId: row.id,
        })
      }
    }

    afterId = rows.at(-1)?.id
  }

  logger.info('Paused billing attribution backfill completed', summary)
  return summary
}

export const backfillPausedBillingAttribution: ScriptMigration = {
  name: '0002_backfill_paused_billing_attribution',
  async up(sql) {
    await runPausedBillingAttributionBackfill(createPausedBillingAttributionStore(sql))
  },
}

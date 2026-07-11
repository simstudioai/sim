#!/usr/bin/env bun

/**
 * Inventories and explicitly migrates durable state for the immutable billing
 * attribution cutover.
 *
 * The rollout sequence is strict:
 * 1. Pause producers that enqueue workflow, schedule, webhook, table-cell,
 *    resume, knowledge-document, and connector-sync work.
 * 2. Drain the reported database queues/runs and inspect every Trigger.dev task
 *    type printed by this script until no active run remains.
 * 3. Migrate active paused snapshots with the explicit confirmation token.
 * 4. Run `--assert-clean` with the Trigger.dev drain acknowledgement.
 * 5. Co-deploy the application and workers with strict consumers.
 * 6. Enable any strict Copilot billing protocol flag in a separate operation.
 *
 * Default and `--assert-clean` modes are read-only. Migration only updates the
 * nested `execution_snapshot.snapshot.metadata.billingAttribution` value on
 * active `paused_executions` rows. It never updates usage rows, queued payloads,
 * running execution payloads, or cancellation state. There is no compatibility
 * fallback: strict consumers must not deploy until this sequence completes.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts
 *   DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts --migrate-paused --confirm-migrate-paused=freeze-current-billing-attribution
 *   DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts --assert-clean --confirm-trigger-dev-drained
 */

import { pathToFileURL } from 'node:url'
import { db } from '@sim/db'
import { asyncJobs, pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  type ResolveBillingAttributionParams,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES } from '@/lib/workflows/executor/paused-execution-policy'

const logger = createLogger('BillingAttributionCutoverInventory')

export const PAUSED_MIGRATION_CONFIRMATION = 'freeze-current-billing-attribution'
export const DEFAULT_PAUSED_BATCH_SIZE = 50
export const MAX_PAUSED_BATCH_SIZE = 100
export const MAX_PAUSED_SNAPSHOT_BYTES = MAX_PAUSED_EXECUTION_SNAPSHOT_BYTES

const MAX_FAILURE_LOGS = 10
const DATABASE_DRAIN_JOB_TYPES = [
  'workflow-execution',
  'schedule-execution',
  'webhook-execution',
  'resume-execution',
  'workflow-group-cell',
] as const
const ACTIVE_JOB_STATUSES = ['pending', 'processing'] as const
const ACTIVE_PAUSE_STATUSES = ['paused', 'partially_resumed', 'cancelling'] as const
const ACTIVE_EXECUTION_STATUSES = ['running', 'pending'] as const

export const TRIGGER_DEV_TASK_TYPES = [
  'workflow-execution',
  'schedule-execution',
  'webhook-execution',
  'resume-execution',
  'workflow-group-cell',
  'knowledge-process-document',
  'knowledge-connector-sync',
] as const

export const TRIGGER_DEV_ACTIVE_STATUSES = [
  'QUEUED',
  'WAITING_FOR_DEPLOY',
  'EXECUTING',
  'RESCHEDULED',
  'FROZEN',
] as const

export const HELP_TEXT = `Billing attribution durable cutover

Default mode is read-only inventory:
  DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts

Migrate active paused snapshots only:
  DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts \\
    --migrate-paused \\
    --confirm-migrate-paused=${PAUSED_MIGRATION_CONFIRMATION}

Assert the database is clean after manually draining Trigger.dev:
  DATABASE_URL=... bun apps/sim/scripts/billing-attribution-cutover-inventory.ts \\
    --assert-clean \\
    --confirm-trigger-dev-drained

Options:
  --batch-size=N                  Keyset page size, 1-${MAX_PAUSED_BATCH_SIZE} (default ${DEFAULT_PAUSED_BATCH_SIZE})
  --migrate-paused                Enable the only write mode
  --confirm-migrate-paused=TOKEN  Required token: ${PAUSED_MIGRATION_CONFIRMATION}
  --assert-clean                  Fail while DB queues/runs or paused migration blockers remain
  --confirm-trigger-dev-drained   Acknowledge manual inspection found no active Trigger.dev runs
  --help                          Print this help without accessing the database

Required rollout sequence:
  1. Pause durable-work producers.
  2. Drain DB queues/runs and inspect Trigger.dev tasks:
     ${TRIGGER_DEV_TASK_TYPES.join(', ')}
     Active Trigger.dev statuses: ${TRIGGER_DEV_ACTIVE_STATUSES.join(', ')}
  3. Run the confirmed paused-snapshot migration.
  4. Run the confirmed clean assertion.
  5. Co-deploy the application and workers with strict consumers.
  6. Enable any strict Copilot protocol flag separately.

The migration freezes the payer resolved at migration time. It does not migrate
async_jobs or running execution payloads, alter usage rows, cancel paused work,
or provide a runtime compatibility fallback.
`

export interface InventoryGroup {
  count: number
  status: string
  type?: string
}

export interface CutoverInventory {
  asyncJobs: InventoryGroup[]
  invalidPausedSnapshots: number
  pausedExecutions: InventoryGroup[]
  pausedExecutionsScanned: number
  workflowExecutions: InventoryGroup[]
  totalBlockingRows: number
}

export interface PausedExecutionCursorRow {
  id: string
}

export interface PausedExecutionCandidate {
  executionId: string
  executionSnapshot: unknown
  id: string
  snapshotBytes: number
  status: string
  workflowId: string
}

export interface ConditionalPausedAttributionUpdate {
  expectedExecutionSnapshot: unknown
  id: string
  nextExecutionSnapshot: unknown
}

export interface PausedExecutionStore {
  listActiveIds(afterId: string | undefined, limit: number): Promise<PausedExecutionCursorRow[]>
  loadActive(id: string): Promise<PausedExecutionCandidate | null>
  writeAttribution(update: ConditionalPausedAttributionUpdate): Promise<boolean>
}

interface ParsedPausedSnapshotBase {
  actorUserId: string
  executionSnapshot: Record<string, unknown>
  metadata: Record<string, unknown>
  snapshot: Record<string, unknown>
  workspaceId: string
}

export type ParsedPausedSnapshot =
  | (ParsedPausedSnapshotBase & { state: 'missing' })
  | (ParsedPausedSnapshotBase & {
      billingAttribution: BillingAttributionSnapshot
      state: 'attributed'
    })

export interface PausedMigrationSummary {
  batches: number
  failed: number
  migrated: number
  scanned: number
  skipped: number
}

interface PausedInventory {
  groups: InventoryGroup[]
  invalid: number
  scanned: number
}

interface CliOptions {
  batchSize: number
  confirmTriggerDevDrained: boolean
  help: boolean
  mode: 'assert-clean' | 'inventory' | 'migrate-paused'
}

export type BillingAttributionResolver = (
  params: ResolveBillingAttributionParams
) => Promise<BillingAttributionSnapshot>

function normalizeCount(value: number | string): number {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid inventory count: ${String(value)}`)
  }
  return normalized
}

function normalizeBatchSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAUSED_BATCH_SIZE) {
    throw new Error(`Batch size must be an integer from 1 to ${MAX_PAUSED_BATCH_SIZE}`)
  }
  return value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Parses the persisted actor/workspace and validates every binding strict resume
 * consumers rely on. Existing invalid attribution is never treated as missing.
 */
export function parsePausedExecutionSnapshot(
  candidate: Pick<PausedExecutionCandidate, 'executionId' | 'executionSnapshot' | 'workflowId'>
): ParsedPausedSnapshot {
  if (!isRecordLike(candidate.executionSnapshot)) {
    throw new Error('Paused execution snapshot envelope must be an object')
  }

  const executionSnapshot = candidate.executionSnapshot
  if (
    typeof executionSnapshot.snapshot !== 'string' ||
    !Array.isArray(executionSnapshot.triggerIds) ||
    !executionSnapshot.triggerIds.every((value) => typeof value === 'string')
  ) {
    throw new Error('Paused execution snapshot envelope is invalid')
  }
  if (Buffer.byteLength(executionSnapshot.snapshot, 'utf8') > MAX_PAUSED_SNAPSHOT_BYTES) {
    throw new Error('Paused execution snapshot exceeds the migration byte limit')
  }

  let snapshotValue: unknown
  try {
    snapshotValue = JSON.parse(executionSnapshot.snapshot)
  } catch {
    throw new Error('Paused execution snapshot JSON is malformed')
  }
  if (!isRecordLike(snapshotValue)) {
    throw new Error('Paused execution snapshot metadata is invalid')
  }

  const snapshot = snapshotValue
  const metadataValue = snapshot.metadata
  if (!isRecordLike(metadataValue)) {
    throw new Error('Paused execution snapshot metadata is invalid')
  }
  const metadata = metadataValue
  if (
    !isNonEmptyString(metadata.userId) ||
    !isNonEmptyString(metadata.workspaceId) ||
    !isNonEmptyString(metadata.workflowId) ||
    !isNonEmptyString(metadata.executionId)
  ) {
    throw new Error('Paused execution snapshot is missing actor or execution bindings')
  }
  if (
    metadata.workflowId !== candidate.workflowId ||
    metadata.executionId !== candidate.executionId
  ) {
    throw new Error('Paused execution snapshot does not match its durable row')
  }

  const parsedBase: ParsedPausedSnapshotBase = {
    actorUserId: metadata.userId,
    executionSnapshot,
    metadata,
    snapshot,
    workspaceId: metadata.workspaceId,
  }
  if (!Object.hasOwn(metadata, 'billingAttribution')) {
    return { ...parsedBase, state: 'missing' }
  }

  const billingAttribution = assertBillingAttributionSnapshot(metadata.billingAttribution)
  if (
    billingAttribution.actorUserId !== parsedBase.actorUserId ||
    billingAttribution.workspaceId !== parsedBase.workspaceId
  ) {
    throw new Error('Paused execution attribution does not match its persisted actor and workspace')
  }
  return { ...parsedBase, billingAttribution, state: 'attributed' }
}

/**
 * Builds the exact string-encoded nested metadata shape consumed by resume.
 */
export function buildAttributedPausedExecutionSnapshot(
  parsed: Extract<ParsedPausedSnapshot, { state: 'missing' }>,
  attributionValue: BillingAttributionSnapshot
): Record<string, unknown> {
  const billingAttribution = assertBillingAttributionSnapshot(attributionValue)
  if (
    billingAttribution.actorUserId !== parsed.actorUserId ||
    billingAttribution.workspaceId !== parsed.workspaceId
  ) {
    throw new Error('Resolved billing attribution does not match the persisted paused snapshot')
  }

  const snapshot = {
    ...parsed.snapshot,
    metadata: {
      ...parsed.metadata,
      billingAttribution,
    },
  }
  const serializedSnapshot = JSON.stringify(snapshot)
  if (Buffer.byteLength(serializedSnapshot, 'utf8') > MAX_PAUSED_SNAPSHOT_BYTES) {
    throw new Error('Attributed paused execution snapshot exceeds the migration byte limit')
  }

  return {
    ...parsed.executionSnapshot,
    snapshot: serializedSnapshot,
  }
}

export const databasePausedExecutionStore: PausedExecutionStore = {
  async listActiveIds(afterId, limit) {
    const activeStatuses = inArray(pausedExecutions.status, [...ACTIVE_PAUSE_STATUSES])
    const rows = await db
      .select({ id: pausedExecutions.id })
      .from(pausedExecutions)
      .where(afterId ? and(activeStatuses, gt(pausedExecutions.id, afterId)) : activeStatuses)
      .orderBy(asc(pausedExecutions.id))
      .limit(limit)
    return rows
  },

  async loadActive(id) {
    const [row] = await db
      .select({
        id: pausedExecutions.id,
        workflowId: pausedExecutions.workflowId,
        executionId: pausedExecutions.executionId,
        status: pausedExecutions.status,
        snapshotBytes:
          sql<number>`octet_length(${pausedExecutions.executionSnapshot}::text)`.mapWith(Number),
        executionSnapshot: sql<unknown | null>`CASE
          WHEN octet_length(${pausedExecutions.executionSnapshot}::text) <= ${MAX_PAUSED_SNAPSHOT_BYTES}
          THEN ${pausedExecutions.executionSnapshot}
          ELSE NULL::jsonb
        END`,
      })
      .from(pausedExecutions)
      .where(
        and(
          eq(pausedExecutions.id, id),
          inArray(pausedExecutions.status, [...ACTIVE_PAUSE_STATUSES])
        )
      )
      .limit(1)

    if (!row) return null
    return {
      ...row,
      snapshotBytes: normalizeCount(row.snapshotBytes),
    }
  },

  async writeAttribution({ expectedExecutionSnapshot, id, nextExecutionSnapshot }) {
    const updatedRows = await db
      .update(pausedExecutions)
      .set({ executionSnapshot: nextExecutionSnapshot })
      .where(
        and(
          eq(pausedExecutions.id, id),
          inArray(pausedExecutions.status, [...ACTIVE_PAUSE_STATUSES]),
          eq(pausedExecutions.executionSnapshot, expectedExecutionSnapshot)
        )
      )
      .returning({ id: pausedExecutions.id })

    if (updatedRows.length > 1) {
      throw new Error(`Conditional paused execution update affected ${updatedRows.length} rows`)
    }
    return updatedRows.length === 1
  },
}

function assertKeysetPage(
  rows: readonly PausedExecutionCursorRow[],
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

async function walkActivePausedIds(
  store: PausedExecutionStore,
  batchSizeValue: number,
  visit: (id: string) => Promise<void>
): Promise<{ batches: number; scanned: number }> {
  const batchSize = normalizeBatchSize(batchSizeValue)
  let afterId: string | undefined
  let batches = 0
  let scanned = 0

  for (;;) {
    const rows = await store.listActiveIds(afterId, batchSize)
    assertKeysetPage(rows, afterId, batchSize)
    if (rows.length === 0) break

    batches += 1
    for (const row of rows) {
      scanned += 1
      await visit(row.id)
    }
    afterId = rows.at(-1)?.id
  }

  return { batches, scanned }
}

function incrementStatusCount(counts: Map<string, number>, status: string): void {
  counts.set(status, (counts.get(status) ?? 0) + 1)
}

async function collectPausedInventory(
  store: PausedExecutionStore,
  batchSize: number
): Promise<PausedInventory> {
  const counts = new Map<string, number>()
  let invalid = 0

  const walk = await walkActivePausedIds(store, batchSize, async (id) => {
    const candidate = await store.loadActive(id)
    if (!candidate) return
    if (candidate.snapshotBytes > MAX_PAUSED_SNAPSHOT_BYTES) {
      invalid += 1
      incrementStatusCount(counts, candidate.status)
      return
    }

    try {
      const parsed = parsePausedExecutionSnapshot(candidate)
      if (parsed.state === 'missing') incrementStatusCount(counts, candidate.status)
    } catch {
      invalid += 1
      incrementStatusCount(counts, candidate.status)
    }
  })

  const groups = ACTIVE_PAUSE_STATUSES.flatMap((status) => {
    const groupCount = counts.get(status) ?? 0
    return groupCount > 0 ? [{ status, count: groupCount }] : []
  })
  return { groups, invalid, scanned: walk.scanned }
}

function sumInventoryGroups(groups: readonly InventoryGroup[]): number {
  return groups.reduce((total, group) => total + group.count, 0)
}

/**
 * Reads all cutover blockers. Queue and execution-log queries are aggregate,
 * while paused rows are inspected in bounded keyset pages.
 */
export async function collectInventory(
  options: { batchSize?: number; pausedStore?: PausedExecutionStore } = {}
): Promise<CutoverInventory> {
  const batchSize = normalizeBatchSize(options.batchSize ?? DEFAULT_PAUSED_BATCH_SIZE)
  const pausedStore = options.pausedStore ?? databasePausedExecutionStore

  const asyncJobRows = await db
    .select({
      type: asyncJobs.type,
      status: asyncJobs.status,
      count: count(),
    })
    .from(asyncJobs)
    .where(
      and(
        inArray(asyncJobs.type, [...DATABASE_DRAIN_JOB_TYPES]),
        inArray(asyncJobs.status, [...ACTIVE_JOB_STATUSES])
      )
    )
    .groupBy(asyncJobs.type, asyncJobs.status)

  const workflowRows = await db
    .select({
      status: workflowExecutionLogs.status,
      count: count(),
    })
    .from(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.status, [...ACTIVE_EXECUTION_STATUSES]))
    .groupBy(workflowExecutionLogs.status)

  const pausedInventory = await collectPausedInventory(pausedStore, batchSize)
  const asyncJobsInventory = asyncJobRows
    .map((row) => ({
      type: row.type,
      status: row.status,
      count: normalizeCount(row.count),
    }))
    .sort((left, right) =>
      `${left.type}:${left.status}`.localeCompare(`${right.type}:${right.status}`)
    )
  const workflowExecutionsInventory = workflowRows
    .map((row) => ({
      status: row.status,
      count: normalizeCount(row.count),
    }))
    .sort((left, right) => left.status.localeCompare(right.status))
  const totalBlockingRows =
    sumInventoryGroups(asyncJobsInventory) +
    sumInventoryGroups(pausedInventory.groups) +
    sumInventoryGroups(workflowExecutionsInventory)

  return {
    asyncJobs: asyncJobsInventory,
    invalidPausedSnapshots: pausedInventory.invalid,
    pausedExecutions: pausedInventory.groups,
    pausedExecutionsScanned: pausedInventory.scanned,
    workflowExecutions: workflowExecutionsInventory,
    totalBlockingRows,
  }
}

/**
 * Migrates active paused rows sequentially. Exact-snapshot equality makes the
 * write idempotent and prevents overwriting any concurrent snapshot change.
 */
export async function migratePausedExecutions(
  options: {
    batchSize?: number
    resolveAttribution?: BillingAttributionResolver
    store?: PausedExecutionStore
  } = {}
): Promise<PausedMigrationSummary> {
  const batchSize = normalizeBatchSize(options.batchSize ?? DEFAULT_PAUSED_BATCH_SIZE)
  const resolveAttribution = options.resolveAttribution ?? resolveBillingAttribution
  const store = options.store ?? databasePausedExecutionStore
  const summary: PausedMigrationSummary = {
    batches: 0,
    failed: 0,
    migrated: 0,
    scanned: 0,
    skipped: 0,
  }
  let loggedFailures = 0

  const walk = await walkActivePausedIds(store, batchSize, async (id) => {
    try {
      const candidate = await store.loadActive(id)
      if (!candidate) {
        summary.skipped += 1
        return
      }
      if (candidate.snapshotBytes > MAX_PAUSED_SNAPSHOT_BYTES) {
        throw new Error(
          `Paused execution snapshot is ${candidate.snapshotBytes} bytes, above the ${MAX_PAUSED_SNAPSHOT_BYTES}-byte limit`
        )
      }

      const parsed = parsePausedExecutionSnapshot(candidate)
      if (parsed.state === 'attributed') {
        summary.skipped += 1
        return
      }

      const billingAttribution = assertBillingAttributionSnapshot(
        await resolveAttribution({
          actorUserId: parsed.actorUserId,
          workspaceId: parsed.workspaceId,
        })
      )
      const nextExecutionSnapshot = buildAttributedPausedExecutionSnapshot(
        parsed,
        billingAttribution
      )
      const migrated = await store.writeAttribution({
        expectedExecutionSnapshot: parsed.executionSnapshot,
        id: candidate.id,
        nextExecutionSnapshot,
      })
      if (migrated) {
        summary.migrated += 1
      } else {
        summary.skipped += 1
      }
    } catch (error) {
      summary.failed += 1
      if (loggedFailures < MAX_FAILURE_LOGS) {
        loggedFailures += 1
        logger.warn('Paused billing attribution migration row failed closed', {
          error: getErrorMessage(error),
          pausedExecutionId: id,
        })
      }
    }
  })

  summary.batches = walk.batches
  summary.scanned = walk.scanned
  return summary
}

export function parseArgs(args: readonly string[]): CliOptions {
  const knownFlags = new Set([
    '--assert-clean',
    '--confirm-trigger-dev-drained',
    '--help',
    '--migrate-paused',
  ])
  const batchArgs = args.filter((arg) => arg.startsWith('--batch-size='))
  const migrationConfirmArgs = args.filter((arg) => arg.startsWith('--confirm-migrate-paused='))

  for (const arg of args) {
    if (
      !knownFlags.has(arg) &&
      !arg.startsWith('--batch-size=') &&
      !arg.startsWith('--confirm-migrate-paused=')
    ) {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (batchArgs.length > 1 || migrationConfirmArgs.length > 1) {
    throw new Error('Batch size and migration confirmation may each be provided only once')
  }

  const migratePaused = args.includes('--migrate-paused')
  const assertClean = args.includes('--assert-clean')
  const confirmTriggerDevDrained = args.includes('--confirm-trigger-dev-drained')
  const migrationConfirmation = migrationConfirmArgs[0]?.slice('--confirm-migrate-paused='.length)
  if (migratePaused && assertClean) {
    throw new Error('Run paused migration and clean assertion as separate rollout steps')
  }
  if (migratePaused && migrationConfirmation !== PAUSED_MIGRATION_CONFIRMATION) {
    throw new Error(
      `Paused migration requires --confirm-migrate-paused=${PAUSED_MIGRATION_CONFIRMATION}`
    )
  }
  if (!migratePaused && migrationConfirmation !== undefined) {
    throw new Error('Migration confirmation is only valid with --migrate-paused')
  }
  if (!assertClean && confirmTriggerDevDrained) {
    throw new Error('Trigger.dev drain confirmation is only valid with --assert-clean')
  }

  const rawBatchSize = batchArgs[0]?.slice('--batch-size='.length)
  const batchSize = rawBatchSize === undefined ? DEFAULT_PAUSED_BATCH_SIZE : Number(rawBatchSize)

  return {
    batchSize: normalizeBatchSize(batchSize),
    confirmTriggerDevDrained,
    help: args.includes('--help'),
    mode: migratePaused ? 'migrate-paused' : assertClean ? 'assert-clean' : 'inventory',
  }
}

/**
 * Fails closed until every DB blocker is gone, paused migration is complete,
 * and the operator acknowledges the separately inspected Trigger.dev drain.
 */
export function assertCutoverClean(
  inventory: CutoverInventory,
  confirmTriggerDevDrained: boolean
): void {
  const blockers: string[] = []
  const asyncJobCount = sumInventoryGroups(inventory.asyncJobs)
  const pausedCount = sumInventoryGroups(inventory.pausedExecutions)
  const workflowExecutionCount = sumInventoryGroups(inventory.workflowExecutions)

  if (asyncJobCount > 0) {
    blockers.push(`${asyncJobCount} active database async job(s) still require draining`)
  }
  if (workflowExecutionCount > 0) {
    blockers.push(`${workflowExecutionCount} running/pending execution(s) still require draining`)
  }
  if (pausedCount > 0) {
    blockers.push(`${pausedCount} active paused snapshot(s) still require migration or repair`)
  }
  if (!confirmTriggerDevDrained) {
    blockers.push(`Trigger.dev drain is not acknowledged for: ${TRIGGER_DEV_TASK_TYPES.join(', ')}`)
  }
  if (blockers.length > 0) {
    throw new Error(`Billing attribution cutover is blocked: ${blockers.join('; ')}`)
  }
}

function logInventory(inventory: CutoverInventory): void {
  logger.info('Billing attribution cutover inventory', {
    ...inventory,
    triggerDevActiveStatuses: TRIGGER_DEV_ACTIVE_STATUSES,
    triggerDevInspectionRequired: true,
    triggerDevTaskTypes: TRIGGER_DEV_TASK_TYPES,
  })
}

export async function runCli(args: readonly string[]): Promise<void> {
  const options = parseArgs(args)
  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return
  }

  if (options.mode === 'migrate-paused') {
    const summary = await migratePausedExecutions({ batchSize: options.batchSize })
    logger.info('Paused billing attribution migration completed', summary)
    const inventory = await collectInventory({ batchSize: options.batchSize })
    logInventory(inventory)
    if (summary.failed > 0) {
      throw new Error(`Paused migration failed closed for ${summary.failed} row(s)`)
    }
    return
  }

  const inventory = await collectInventory({ batchSize: options.batchSize })
  logInventory(inventory)
  if (options.mode === 'assert-clean') {
    assertCutoverClean(inventory, options.confirmTriggerDevDrained)
    logger.info('Billing attribution durable cutover assertion passed')
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    logger.error('Billing attribution cutover tooling failed', { error })
    process.exitCode = 1
  })
}

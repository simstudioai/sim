import { db } from '@sim/db'
import { webhook, workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import { resolveDeployedWebhookUrl } from '@/lib/webhooks/deployed-urls'
import { isInternalTriggerProvider, isPollingWebhookProvider } from '@/triggers/constants'

/**
 * How a deployed trigger is fired: on a cron (`schedule`), by Sim polling a
 * source (`polling`), by an event raised inside Sim (`event`), or by an external
 * sender delivering to a URL (`webhook`).
 */
type WorkflowTriggerKind = 'schedule' | 'polling' | 'event' | 'webhook'

/** `completed` is reachable only by schedules. */
export type WorkflowTriggerStatus = 'active' | 'disabled' | 'completed'

export interface WorkflowTriggerHealth {
  blockId: string
  kind: WorkflowTriggerKind
  provider: string | null
  enabled: boolean
  status: WorkflowTriggerStatus
  failedCount: number
  lastFailedAt: Date | null
  nextRunAt: Date | null
  lastRanAt: Date | null
  cronExpression: string | null
  timezone: string | null
  url: string | null
}

type ScheduleRow = typeof workflowSchedule.$inferSelect
type WebhookRow = typeof webhook.$inferSelect

/** One live trigger row, tagged with the table it lives in. */
export type LiveWorkflowTriggerRecord =
  | { table: 'schedule'; row: ScheduleRow & { blockId: string } }
  | { table: 'webhook'; row: WebhookRow & { blockId: string } }

function activeDeploymentVersionIds(workflowId: string) {
  return db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
}

/**
 * The schedule rows the live deployment serves. Job schedules share the table
 * but belong to no workflow deployment, so they are excluded by source.
 */
function liveSchedulePredicate(workflowId: string): SQL {
  const predicate = and(
    eq(workflowSchedule.workflowId, workflowId),
    inArray(workflowSchedule.deploymentVersionId, activeDeploymentVersionIds(workflowId)),
    isNull(workflowSchedule.archivedAt),
    eq(workflowSchedule.sourceType, 'workflow'),
    isNotNull(workflowSchedule.blockId)
  )
  if (!predicate) throw new Error('Live schedule predicate is empty')
  return predicate
}

/**
 * The webhook rows the live deployment serves. `isActive` is the enablement
 * gate, never the liveness test: a disabled row of the active version is still
 * live, while a `candidate`, `retired`, or `orphaned` registration — or any row
 * of an older version — is not, and must never be revived by an enable.
 */
function liveWebhookPredicate(workflowId: string): SQL {
  const predicate = and(
    eq(webhook.workflowId, workflowId),
    inArray(webhook.deploymentVersionId, activeDeploymentVersionIds(workflowId)),
    isNull(webhook.archivedAt),
    or(eq(webhook.registrationStatus, 'active'), isNull(webhook.registrationStatus)),
    isNotNull(webhook.blockId)
  )
  if (!predicate) throw new Error('Live webhook predicate is empty')
  return predicate
}

function scheduleStatus(status: string): WorkflowTriggerStatus {
  if (status === 'active' || status === 'disabled' || status === 'completed') return status
  throw new Error(`Schedule has an unknown status: ${status}`)
}

function webhookKind(provider: string | null): Exclude<WorkflowTriggerKind, 'schedule'> {
  if (isPollingWebhookProvider(provider)) return 'polling'
  if (isInternalTriggerProvider(provider)) return 'event'
  return 'webhook'
}

/** Projects a live trigger row onto its health view. */
export function toWorkflowTriggerHealth(record: LiveWorkflowTriggerRecord): WorkflowTriggerHealth {
  if (record.table === 'schedule') {
    const { row } = record
    const status = scheduleStatus(row.status)
    return {
      blockId: row.blockId,
      kind: 'schedule',
      provider: null,
      enabled: status === 'active',
      status,
      failedCount: row.failedCount,
      lastFailedAt: row.lastFailedAt,
      nextRunAt: row.nextRunAt,
      lastRanAt: row.lastRanAt,
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      url: null,
    }
  }
  const { row } = record
  const kind = webhookKind(row.provider)
  return {
    blockId: row.blockId,
    kind,
    provider: row.provider,
    enabled: row.isActive,
    status: row.isActive ? 'active' : 'disabled',
    failedCount: row.failedCount ?? 0,
    lastFailedAt: row.lastFailedAt,
    nextRunAt: null,
    lastRanAt: null,
    cronExpression: null,
    timezone: null,
    url: kind === 'webhook' ? resolveDeployedWebhookUrl(row) : null,
  }
}

function withBlockId<R extends { blockId: string | null }>(row: R): R & { blockId: string } {
  if (row.blockId === null) throw new Error('Live trigger row is missing its block')
  return { ...row, blockId: row.blockId }
}

/** Every trigger the workflow's live deployment serves, ordered by block. Empty when undeployed. */
export async function listLiveWorkflowTriggers(
  workflowId: string
): Promise<LiveWorkflowTriggerRecord[]> {
  const [schedules, webhooks] = await Promise.all([
    db
      .select()
      .from(workflowSchedule)
      .where(liveSchedulePredicate(workflowId))
      .orderBy(asc(workflowSchedule.blockId), asc(workflowSchedule.id)),
    db
      .select()
      .from(webhook)
      .where(liveWebhookPredicate(workflowId))
      .orderBy(asc(webhook.blockId), asc(webhook.id)),
  ])
  const records: LiveWorkflowTriggerRecord[] = [
    ...schedules.map((row) => ({ table: 'schedule' as const, row: withBlockId(row) })),
    ...webhooks.map((row) => ({ table: 'webhook' as const, row: withBlockId(row) })),
  ]
  return records.sort(
    (a, b) => compareStrings(a.row.blockId, b.row.blockId) || compareStrings(a.row.id, b.row.id)
  )
}

/**
 * The workflow and block an unarchived trigger row belongs to, live or not.
 * Liveness is decided afterwards, once the caller is authorized for the workflow.
 */
export async function findTriggerRowOwner(
  table: LiveWorkflowTriggerRecord['table'],
  rowId: string
): Promise<{ id: string; workflowId: string | null; blockId: string | null } | null> {
  const [row] =
    table === 'schedule'
      ? await db
          .select({
            id: workflowSchedule.id,
            workflowId: workflowSchedule.workflowId,
            blockId: workflowSchedule.blockId,
          })
          .from(workflowSchedule)
          .where(and(eq(workflowSchedule.id, rowId), isNull(workflowSchedule.archivedAt)))
          .limit(1)
      : await db
          .select({ id: webhook.id, workflowId: webhook.workflowId, blockId: webhook.blockId })
          .from(webhook)
          .where(and(eq(webhook.id, rowId), isNull(webhook.archivedAt)))
          .limit(1)
  return row ?? null
}

/**
 * The live trigger a block serves, optionally pinned to one row id. A row that
 * exists but is not live — an older version, an archived row, a non-active
 * registration — reads as absent.
 */
export async function findLiveWorkflowTrigger(input: {
  workflowId: string
  blockId: string
  rowId?: string
}): Promise<LiveWorkflowTriggerRecord | null> {
  const [schedule] = await db
    .select()
    .from(workflowSchedule)
    .where(
      and(
        liveSchedulePredicate(input.workflowId),
        eq(workflowSchedule.blockId, input.blockId),
        input.rowId ? eq(workflowSchedule.id, input.rowId) : undefined
      )
    )
    .orderBy(asc(workflowSchedule.id))
    .limit(1)
  if (schedule) return { table: 'schedule', row: withBlockId(schedule) }

  const [row] = await db
    .select()
    .from(webhook)
    .where(
      and(
        liveWebhookPredicate(input.workflowId),
        eq(webhook.blockId, input.blockId),
        input.rowId ? eq(webhook.id, input.rowId) : undefined
      )
    )
    .orderBy(asc(webhook.id))
    .limit(1)
  return row ? { table: 'webhook', row: withBlockId(row) } : null
}

/**
 * Flips one live schedule row in a single conditional write. The predicate is
 * re-evaluated by the `UPDATE` itself, so a redeploy that retires the row
 * between the caller's read and this write leaves it untouched and returns
 * `null`, as does a row already in the requested state.
 *
 * Enabling resets both failure counters and arms `nextRunAt`; disabling clears
 * the pending run and any claim.
 */
export async function setLiveScheduleEnabled(input: {
  workflowId: string
  scheduleId: string
  enabled: boolean
  nextRunAt: Date | null
  now: Date
}): Promise<LiveWorkflowTriggerRecord | null> {
  const [updated] = await db
    .update(workflowSchedule)
    .set(
      input.enabled
        ? {
            status: 'active',
            failedCount: 0,
            infraRetryCount: 0,
            nextRunAt: input.nextRunAt,
            updatedAt: input.now,
          }
        : { status: 'disabled', nextRunAt: null, lastQueuedAt: null, updatedAt: input.now }
    )
    .where(
      and(
        eq(workflowSchedule.id, input.scheduleId),
        liveSchedulePredicate(input.workflowId),
        input.enabled
          ? ne(workflowSchedule.status, 'active')
          : eq(workflowSchedule.status, 'active')
      )
    )
    .returning()
  return updated ? { table: 'schedule', row: withBlockId(updated) } : null
}

/**
 * Flips one live webhook row in a single conditional write, with the same
 * race guarantees as {@link setLiveScheduleEnabled}.
 *
 * Enabling resets the failure count and drops a poller's source backoff, so a
 * re-enabled polling trigger is polled on the next tick instead of waiting out
 * a window earned before it was disabled.
 */
export async function setLiveWebhookEnabled(input: {
  workflowId: string
  webhookId: string
  enabled: boolean
  now: Date
}): Promise<LiveWorkflowTriggerRecord | null> {
  /** The keys `recordPollSourceFailure` writes; literals, because `jsonb - $1` is overloaded. */
  const clearedBackoff = sql`(${webhook.providerConfig}::jsonb - 'pollBackoffUntil' - 'pollSourceFailures')::json`
  const [updated] = await db
    .update(webhook)
    .set(
      input.enabled
        ? { isActive: true, failedCount: 0, providerConfig: clearedBackoff, updatedAt: input.now }
        : { isActive: false, updatedAt: input.now }
    )
    .where(
      and(
        eq(webhook.id, input.webhookId),
        liveWebhookPredicate(input.workflowId),
        eq(webhook.isActive, !input.enabled)
      )
    )
    .returning()
  return updated ? { table: 'webhook', row: withBlockId(updated) } : null
}

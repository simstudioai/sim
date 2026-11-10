import { db } from '@sim/db'
import { webhook, workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { resolveDeployedWebhookUrl } from '@/lib/webhooks/deployed-urls'
import { POLL_BACKOFF_UNTIL_KEY, POLL_SOURCE_FAILURES_KEY } from '@/lib/webhooks/polling/utils'
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
 * The deployment-version test every delivery path and editor read applies: the
 * row belongs to the active version, or the workflow has no active version and
 * the row names none (a deploy that predates versions). The schedule dispatcher
 * additionally skips that versionless case, so such a schedule is listed and
 * switchable, exactly as the editor shows it, but does not fire.
 */
function servedByLiveDeployment(deploymentVersionId: AnyPgColumn, workflowId: string): SQL {
  const predicate = or(
    inArray(deploymentVersionId, activeDeploymentVersionIds(workflowId)),
    and(isNull(deploymentVersionId), notExists(activeDeploymentVersionIds(workflowId)))
  )
  if (!predicate) throw new Error('Live deployment predicate is empty')
  return predicate
}

/**
 * The schedule rows the live deployment serves. Job schedules share the table
 * but belong to no workflow deployment, so they are excluded by source.
 */
function liveSchedulePredicate(workflowId: string): SQL {
  const predicate = and(
    eq(workflowSchedule.workflowId, workflowId),
    servedByLiveDeployment(workflowSchedule.deploymentVersionId, workflowId),
    isNull(workflowSchedule.archivedAt),
    or(eq(workflowSchedule.sourceType, 'workflow'), isNull(workflowSchedule.sourceType)),
    isNotNull(workflowSchedule.blockId)
  )
  if (!predicate) throw new Error('Live schedule predicate is empty')
  return predicate
}

/**
 * The webhook rows the live deployment serves, matching the delivery and
 * polling lookups. `isActive` is the enablement gate, never the liveness test:
 * a disabled row of the active version is still live, while a row of an older
 * version, or a `candidate`, `retired`, or `orphaned` registration (always
 * archived), is not, and must never be revived by an enable.
 */
function liveWebhookPredicate(workflowId: string): SQL {
  const predicate = and(
    eq(webhook.workflowId, workflowId),
    servedByLiveDeployment(webhook.deploymentVersionId, workflowId),
    isNull(webhook.archivedAt),
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

/** Every trigger the workflow's live deployment serves, ordered by block. */
export async function listLiveWorkflowTriggers(
  workflowId: string
): Promise<LiveWorkflowTriggerRecord[]> {
  const [schedules, webhooks] = await Promise.all([
    db.select().from(workflowSchedule).where(liveSchedulePredicate(workflowId)),
    db.select().from(webhook).where(liveWebhookPredicate(workflowId)),
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
 * The live rows a block serves: its schedules, or else its webhook rows, newest
 * first as the editor reads them. A block normally has one, but rows written
 * before registrations were tracked can leave several. Pinned to `row`, only
 * that row, and only while it is live: an older version, an archived row, or a
 * non-active registration reads as absent.
 */
export async function findLiveBlockTriggers(input: {
  workflowId: string
  blockId: string
  row?: { table: LiveWorkflowTriggerRecord['table']; id: string }
}): Promise<LiveWorkflowTriggerRecord[]> {
  const { row } = input
  const [schedules, webhooks] = await Promise.all([
    row?.table === 'webhook'
      ? []
      : db
          .select()
          .from(workflowSchedule)
          .where(
            and(
              liveSchedulePredicate(input.workflowId),
              eq(workflowSchedule.blockId, input.blockId),
              row ? eq(workflowSchedule.id, row.id) : undefined
            )
          )
          .orderBy(asc(workflowSchedule.id)),
    row?.table === 'schedule'
      ? []
      : db
          .select()
          .from(webhook)
          .where(
            and(
              liveWebhookPredicate(input.workflowId),
              eq(webhook.blockId, input.blockId),
              row ? eq(webhook.id, row.id) : undefined
            )
          )
          .orderBy(desc(webhook.updatedAt), asc(webhook.id)),
  ])
  if (schedules.length > 0) {
    return schedules.map((schedule) => ({ table: 'schedule', row: withBlockId(schedule) }))
  }
  return webhooks.map((hook) => ({ table: 'webhook', row: withBlockId(hook) }))
}

/** Whether a live row already is in the requested state. Disabling moves a completed schedule to `disabled`. */
export function isInRequestedState(record: LiveWorkflowTriggerRecord, enabled: boolean): boolean {
  if (record.table === 'webhook') return record.row.isActive === enabled
  return record.row.status === (enabled ? 'active' : 'disabled')
}

/**
 * Switches live rows in one transaction of conditional writes. Each `UPDATE`
 * re-evaluates liveness and the current state itself, so a row a redeploy
 * retired, or one already switched, since the caller's read is left untouched
 * and absent from the result.
 *
 * Enabling a schedule resets both failure counters and arms `nextRunAt`;
 * disabling clears the pending run and any claim. Enabling a webhook resets the
 * failure count and drops a poller's source backoff, so a re-enabled polling
 * trigger is polled on the next tick instead of waiting out a window earned
 * before it was disabled.
 */
export async function setLiveTriggersEnabled(input: {
  workflowId: string
  enabled: boolean
  schedules: { id: string; nextRunAt: Date | null }[]
  webhookIds: string[]
  now: Date
}): Promise<LiveWorkflowTriggerRecord[]> {
  const { workflowId, enabled, now } = input
  return db.transaction(async (tx) => {
    const updated: LiveWorkflowTriggerRecord[] = []
    for (const schedule of input.schedules) {
      const [row] = await tx
        .update(workflowSchedule)
        .set(
          enabled
            ? {
                status: 'active',
                failedCount: 0,
                infraRetryCount: 0,
                nextRunAt: schedule.nextRunAt,
                updatedAt: now,
              }
            : { status: 'disabled', nextRunAt: null, lastQueuedAt: null, updatedAt: now }
        )
        .where(
          and(
            eq(workflowSchedule.id, schedule.id),
            liveSchedulePredicate(workflowId),
            ne(workflowSchedule.status, enabled ? 'active' : 'disabled')
          )
        )
        .returning()
      if (row) updated.push({ table: 'schedule', row: withBlockId(row) })
    }

    if (input.webhookIds.length > 0) {
      const clearedBackoff = sql`(${webhook.providerConfig}::jsonb - ${POLL_BACKOFF_UNTIL_KEY}::text - ${POLL_SOURCE_FAILURES_KEY}::text)::json`
      const rows = await tx
        .update(webhook)
        .set(
          enabled
            ? { isActive: true, failedCount: 0, providerConfig: clearedBackoff, updatedAt: now }
            : { isActive: false, updatedAt: now }
        )
        .where(
          and(
            inArray(webhook.id, input.webhookIds),
            liveWebhookPredicate(workflowId),
            eq(webhook.isActive, !enabled)
          )
        )
        .returning()
      for (const row of rows) updated.push({ table: 'webhook', row: withBlockId(row) })
    }
    return updated
  })
}

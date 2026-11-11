import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion, workflowSchedule } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import {
  and,
  asc,
  desc,
  eq,
  exists,
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
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { resolveDeployedWebhookUrl } from '@/lib/webhooks/deployed-urls'
import { POLL_BACKOFF_UNTIL_KEY, POLL_SOURCE_FAILURES_KEY } from '@/lib/webhooks/polling/utils'
import {
  isInternalTriggerProvider,
  isPollingWebhookProvider,
  POLLING_PROVIDERS,
} from '@/triggers/constants'

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
 * Which rows count as live.
 *
 * `running` is what actually fires: a row of the active version of a deployed
 * workflow. The schedule dispatcher and preprocessing's deployment check both
 * require it, and webhook processing refuses a block missing from the active
 * version, so a versionless row never runs. The v2 surface reports only these.
 *
 * `editor` is what the editor's reads show: the active version's rows, or,
 * when the workflow has no active version, rows that name none (a deploy that
 * predates versions, or a webhook saved before the first deploy). The legacy
 * row-id routes keep switching those, as they always have.
 */
export type TriggerLiveness = 'running' | 'editor'

function servedByDeployment(
  deploymentVersionId: AnyPgColumn,
  workflowId: string,
  liveness: TriggerLiveness
): SQL {
  const predicate =
    liveness === 'running'
      ? and(
          inArray(deploymentVersionId, activeDeploymentVersionIds(workflowId)),
          exists(
            db
              .select({ id: workflow.id })
              .from(workflow)
              .where(and(eq(workflow.id, workflowId), eq(workflow.isDeployed, true)))
          )
        )
      : or(
          inArray(deploymentVersionId, activeDeploymentVersionIds(workflowId)),
          and(isNull(deploymentVersionId), notExists(activeDeploymentVersionIds(workflowId)))
        )
  if (!predicate) throw new Error('Live deployment predicate is empty')
  return predicate
}

/** An unarchived workflow (not job) schedule row that names its block. */
function workflowScheduleRowPredicate(): SQL | undefined {
  return and(
    isNull(workflowSchedule.archivedAt),
    or(eq(workflowSchedule.sourceType, 'workflow'), isNull(workflowSchedule.sourceType)),
    isNotNull(workflowSchedule.blockId)
  )
}

/**
 * The schedule rows the deployment serves. Job schedules share the table but
 * belong to no workflow deployment, so they are excluded by source.
 */
function liveSchedulePredicate(workflowId: string, liveness: TriggerLiveness): SQL {
  const predicate = and(
    eq(workflowSchedule.workflowId, workflowId),
    servedByDeployment(workflowSchedule.deploymentVersionId, workflowId, liveness),
    workflowScheduleRowPredicate()
  )
  if (!predicate) throw new Error('Live schedule predicate is empty')
  return predicate
}

/**
 * The webhook rows the deployment serves. `isActive` is the enablement gate,
 * never the liveness test: a disabled row of the active version is still live,
 * while a row of an older version, or a `candidate`, `retired`, or `orphaned`
 * registration (always archived), is not, and must never be revived by an
 * enable.
 */
function liveWebhookPredicate(workflowId: string, liveness: TriggerLiveness): SQL {
  const predicate = and(
    eq(webhook.workflowId, workflowId),
    servedByDeployment(webhook.deploymentVersionId, workflowId, liveness),
    isNull(webhook.archivedAt),
    isNotNull(webhook.blockId)
  )
  if (!predicate) throw new Error('Live webhook predicate is empty')
  return predicate
}

/**
 * An unrecognized status reads as `active`, because the dispatcher fires every
 * schedule that is neither `disabled` nor `completed` and the editor shows it
 * as not disabled.
 */
function scheduleStatus(status: string): WorkflowTriggerStatus {
  return status === 'disabled' || status === 'completed' ? status : 'active'
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

/** Every trigger the workflow's live deployment runs, ordered by block. */
export async function listLiveWorkflowTriggers(
  workflowId: string
): Promise<LiveWorkflowTriggerRecord[]> {
  const [schedules, webhooks] = await Promise.all([
    db.select().from(workflowSchedule).where(liveSchedulePredicate(workflowId, 'running')),
    db.select().from(webhook).where(liveWebhookPredicate(workflowId, 'running')),
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
  liveness: TriggerLiveness
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
              liveSchedulePredicate(input.workflowId, input.liveness),
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
              liveWebhookPredicate(input.workflowId, input.liveness),
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

class TriggerSwitchConflict extends Error {}

/**
 * Switches live rows all or nothing. Each `UPDATE` re-evaluates liveness and
 * the current state itself; if any row a redeploy retired, or another request
 * switched, since the caller's read is not written, the whole transaction rolls
 * back and the result is `null`, so a caller never commits part of a block.
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
  liveness: TriggerLiveness
  now: Date
}): Promise<LiveWorkflowTriggerRecord[] | null> {
  const { workflowId, enabled, liveness, now } = input
  try {
    return await db.transaction(async (tx) => {
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
              liveSchedulePredicate(workflowId, liveness),
              ne(workflowSchedule.status, enabled ? 'active' : 'disabled')
            )
          )
          .returning()
        if (!row) throw new TriggerSwitchConflict()
        updated.push({ table: 'schedule', row: withBlockId(row) })
      }

      if (input.webhookIds.length > 0) {
        /** Only a poller records backoff, and only an object config can hold it. */
        const clearedBackoff = sql`CASE WHEN ${inArray(webhook.provider, [...POLLING_PROVIDERS])} AND jsonb_typeof(${webhook.providerConfig}::jsonb) = 'object' THEN (${webhook.providerConfig}::jsonb - ${POLL_BACKOFF_UNTIL_KEY}::text - ${POLL_SOURCE_FAILURES_KEY}::text)::json ELSE ${webhook.providerConfig} END`
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
              liveWebhookPredicate(workflowId, liveness),
              eq(webhook.isActive, !enabled)
            )
          )
          .returning()
        if (rows.length !== input.webhookIds.length) throw new TriggerSwitchConflict()
        for (const row of rows) updated.push({ table: 'webhook', row: withBlockId(row) })
      }
      return updated
    })
  } catch (error) {
    if (error instanceof TriggerSwitchConflict) return null
    throw error
  }
}

/** A live schedule of some workflow in a workspace, with that workflow's name. */
export interface WorkspaceScheduleRecord {
  workflowId: string
  workflowName: string
  health: WorkflowTriggerHealth
}

interface WorkspaceScheduleRow {
  schedule: ScheduleRow
  workflowId: string
  workflowName: string
}

const WORKSPACE_SCHEDULE_SORTS = {
  createdAt: [
    timestampKey<WorkspaceScheduleRow>(workflowSchedule.createdAt, (row) => row.schedule.createdAt),
    textKey<WorkspaceScheduleRow>(workflowSchedule.id, (row) => row.schedule.id),
  ],
} satisfies Record<'createdAt', readonly KeysetKey<WorkspaceScheduleRow>[]>

/**
 * One keyset page of the schedules every deployed workflow in a workspace runs:
 * the same rows {@link listLiveWorkflowTriggers} reports as `running` for each
 * workflow, joined across the workspace in one ordered read.
 */
export async function listWorkspaceLiveSchedulesPage(params: {
  workspaceId: string
  sortBy: keyof typeof WORKSPACE_SCHEDULE_SORTS
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}): Promise<{ data: WorkspaceScheduleRecord[]; nextCursorKeys: CursorKey[] | null }> {
  const keys = WORKSPACE_SCHEDULE_SORTS[params.sortBy]
  const rows = await db
    .select({ schedule: workflowSchedule, workflowId: workflow.id, workflowName: workflow.name })
    .from(workflowSchedule)
    .innerJoin(workflow, eq(workflow.id, workflowSchedule.workflowId))
    .innerJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.id, workflowSchedule.deploymentVersionId),
        eq(workflowDeploymentVersion.workflowId, workflowSchedule.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(workflow.workspaceId, params.workspaceId),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        workflowScheduleRowPredicate(),
        resumeKeyset(keys, params.cursorKeys, params.sortOrder)
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), params.sortOrder))
    .limit(params.limit + 1)

  const page = keysetPage(keys, rows, params.limit)
  return {
    data: page.data.map(({ schedule, workflowId, workflowName }) => ({
      workflowId,
      workflowName,
      health: toWorkflowTriggerHealth({ table: 'schedule', row: withBlockId(schedule) }),
    })),
    nextCursorKeys: page.nextCursorKeys,
  }
}

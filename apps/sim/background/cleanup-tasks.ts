import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotFeedback,
  copilotRunCheckpoints,
  copilotRuns,
  mothershipInboxTask,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { and, inArray, lt, sql } from 'drizzle-orm'
import { type CleanupJobPayload, resolveCleanupScope } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  deleteRowsById,
  type TableCleanupResult,
} from '@/lib/cleanup/batch-delete'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'

const logger = createLogger('CleanupTasks')

/**
 * Delete copilot run checkpoints and async tool calls via join through copilotRuns.
 * These tables don't have a direct workspaceId — we find qualifying run IDs first.
 */
const RUN_CHILD_TABLES = [
  {
    table: copilotRunCheckpoints,
    runIdCol: copilotRunCheckpoints.runId,
    name: 'copilotRunCheckpoints',
  },
  {
    table: copilotAsyncToolCalls,
    runIdCol: copilotAsyncToolCalls.runId,
    name: 'copilotAsyncToolCalls',
  },
] as const

async function deleteByRunIds(
  table: (typeof RUN_CHILD_TABLES)[number]['table'],
  runIdCol: (typeof RUN_CHILD_TABLES)[number]['runIdCol'],
  runIds: string[],
  tableName: string
): Promise<TableCleanupResult> {
  const result: TableCleanupResult = { table: tableName, deleted: 0, failed: 0 }
  try {
    const deleted = await db
      .delete(table)
      .where(inArray(runIdCol, runIds))
      .returning({ id: sql`id` })
    result.deleted = deleted.length
    logger.info(`[${tableName}] Deleted ${deleted.length} rows`)
  } catch (error) {
    result.failed++
    logger.error(`[${tableName}] Delete failed:`, { error })
  }
  return result
}

async function cleanupRunChildren(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<TableCleanupResult[]> {
  if (workspaceIds.length === 0) return []

  const runIds = await db
    .select({ id: copilotRuns.id })
    .from(copilotRuns)
    .where(
      and(inArray(copilotRuns.workspaceId, workspaceIds), lt(copilotRuns.updatedAt, retentionDate))
    )
    .limit(DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE)

  if (runIds.length === 0) {
    return RUN_CHILD_TABLES.map((t) => ({ table: `${label}/${t.name}`, deleted: 0, failed: 0 }))
  }

  const ids = runIds.map((r) => r.id)

  return Promise.all(
    RUN_CHILD_TABLES.map((t) => deleteByRunIds(t.table, t.runIdCol, ids, `${label}/${t.name}`))
  )
}

export async function runCleanupTasks(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()

  const scope = await resolveCleanupScope('cleanup-tasks', payload)
  if (!scope) {
    logger.info(`[${payload.plan}] No retention configured, skipping`)
    return
  }

  const { workspaceIds, retentionHours, label } = scope

  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    return
  }

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  logger.info(
    `[${label}] Processing ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  // Collect chat IDs before deleting so we can clean up the copilot backend after
  const doomedChats = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(
      and(
        inArray(copilotChats.workspaceId, workspaceIds),
        lt(copilotChats.updatedAt, retentionDate)
      )
    )
    .limit(DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE)

  const doomedChatIds = doomedChats.map((c) => c.id)

  // Prepare chat cleanup (collect file keys + copilot backend call) BEFORE DB deletion
  const chatCleanup = await prepareChatCleanup(doomedChatIds, label)

  // Delete run children first (checkpoints, tool calls) since they reference runs
  const runChildResults = await cleanupRunChildren(workspaceIds, retentionDate, label)
  for (const r of runChildResults) {
    if (r.deleted > 0) logger.info(`[${r.table}] ${r.deleted} deleted`)
  }

  // Delete feedback — no direct workspaceId, reuse chat IDs collected above
  const feedbackResult: TableCleanupResult = {
    table: `${label}/copilotFeedback`,
    deleted: 0,
    failed: 0,
  }
  try {
    if (doomedChatIds.length > 0) {
      const deleted = await db
        .delete(copilotFeedback)
        .where(inArray(copilotFeedback.chatId, doomedChatIds))
        .returning({ id: copilotFeedback.feedbackId })
      feedbackResult.deleted = deleted.length
      logger.info(`[${feedbackResult.table}] Deleted ${deleted.length} rows`)
    } else {
      logger.info(`[${feedbackResult.table}] No expired rows found`)
    }
  } catch (error) {
    feedbackResult.failed++
    logger.error(`[${feedbackResult.table}] Delete failed:`, { error })
  }

  // Delete copilot runs (has workspaceId directly, cascades checkpoints)
  const runsResult = await batchDeleteByWorkspaceAndTimestamp({
    tableDef: copilotRuns,
    workspaceIdCol: copilotRuns.workspaceId,
    timestampCol: copilotRuns.updatedAt,
    workspaceIds,
    retentionDate,
    tableName: `${label}/copilotRuns`,
  })

  // Delete copilot chats using the exact IDs collected above so the chat
  // cleanup (S3 + copilot backend) and the DB delete can never disagree.
  const chatsResult = await deleteRowsById(
    copilotChats,
    copilotChats.id,
    doomedChatIds,
    `${label}/copilotChats`
  )

  // Delete mothership inbox tasks (has workspaceId directly)
  const inboxResult = await batchDeleteByWorkspaceAndTimestamp({
    tableDef: mothershipInboxTask,
    workspaceIdCol: mothershipInboxTask.workspaceId,
    timestampCol: mothershipInboxTask.createdAt,
    workspaceIds,
    retentionDate,
    tableName: `${label}/mothershipInboxTask`,
  })

  const totalDeleted =
    runChildResults.reduce((s, r) => s + r.deleted, 0) +
    feedbackResult.deleted +
    runsResult.deleted +
    chatsResult.deleted +
    inboxResult.deleted

  logger.info(`[${label}] Complete: ${totalDeleted} total rows deleted`)

  // Clean up copilot backend + storage files after DB rows are gone
  await chatCleanup.execute()

  const timeElapsed = (Date.now() - startTime) / 1000
  logger.info(`Task cleanup completed in ${timeElapsed.toFixed(2)}s`)
}

export const cleanupTasksTask = task({
  id: 'cleanup-tasks',
  run: runCleanupTasks,
})

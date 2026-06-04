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
import { and, inArray, lt } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  deleteRowsById,
  selectRowsByIdChunks,
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

async function cleanupRunChildren(
  workspaceIds: string[],
  retentionDate: Date,
  label: string
): Promise<TableCleanupResult[]> {
  if (workspaceIds.length === 0) return []

  const runIds = await selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
    db
      .select({ id: copilotRuns.id })
      .from(copilotRuns)
      .where(
        and(inArray(copilotRuns.workspaceId, chunkIds), lt(copilotRuns.updatedAt, retentionDate))
      )
      .limit(chunkLimit)
  )

  if (runIds.length === 0) {
    return RUN_CHILD_TABLES.map((t) => ({ table: `${label}/${t.name}`, deleted: 0, failed: 0 }))
  }

  const ids = runIds.map((r) => r.id)

  return Promise.all(
    RUN_CHILD_TABLES.map((t) => deleteRowsById(t.table, t.runIdCol, ids, `${label}/${t.name}`))
  )
}

export async function runCleanupTasks(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label } = payload

  if (workspaceIds.length === 0) {
    logger.info(`[${label}] No workspaces to process`)
    return
  }

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  logger.info(
    `[${label}] Processing ${workspaceIds.length} workspaces, cutoff: ${retentionDate.toISOString()}`
  )

  const doomedChats = await selectRowsByIdChunks(workspaceIds, (chunkIds, chunkLimit) =>
    db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(inArray(copilotChats.workspaceId, chunkIds), lt(copilotChats.updatedAt, retentionDate))
      )
      .limit(chunkLimit)
  )

  const doomedChatIds = doomedChats.map((c) => c.id)

  // Prepare chat cleanup (collect file keys + copilot backend call) BEFORE DB deletion
  const chatCleanup = await prepareChatCleanup(doomedChatIds, label)

  // Delete run children first (checkpoints, tool calls) since they reference runs
  const runChildResults = await cleanupRunChildren(workspaceIds, retentionDate, label)
  for (const r of runChildResults) {
    if (r.deleted > 0) logger.info(`[${r.table}] ${r.deleted} deleted`)
  }

  // Delete feedback — no direct workspaceId, reuse chat IDs collected above
  const feedbackResult = await deleteRowsById(
    copilotFeedback,
    copilotFeedback.chatId,
    doomedChatIds,
    `${label}/copilotFeedback`
  )

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
  machine: 'large-1x',
  queue: { concurrencyLimit: 5 },
  run: runCleanupTasks,
})

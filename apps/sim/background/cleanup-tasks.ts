import { dbFor } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRunCheckpoints,
  copilotRuns,
  mothershipInboxTask,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { task } from '@trigger.dev/sdk'
import { and, inArray, lt } from 'drizzle-orm'
import type { CleanupJobPayload } from '@/lib/billing/cleanup-dispatcher'
import {
  batchDeleteByWorkspaceAndTimestamp,
  DEFAULT_DELETE_CHUNK_SIZE,
  deleteRowsById,
  selectRowsByIdChunks,
  type TableCleanupResult,
} from '@/lib/cleanup/batch-delete'
import { prepareChatCleanup } from '@/lib/cleanup/chat-cleanup'
import { cleanupOwnerCondition, resolveCleanupOwnerScope } from '@/lib/cleanup/resource-scope'

const logger = createLogger('CleanupTasks')

/** All cleanup queries run on the dedicated cleanup pool. */
const cleanupDb = dbFor('cleanup')

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
    cleanupDb
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
    RUN_CHILD_TABLES.map((t) =>
      deleteRowsById(t.table, t.runIdCol, ids, `${label}/${t.name}`, cleanupDb)
    )
  )
}

export async function runCleanupTasks(payload: CleanupJobPayload): Promise<void> {
  const startTime = Date.now()
  const { workspaceIds, retentionHours, label } = payload
  const scope = resolveCleanupOwnerScope(payload)

  if (scope.ids.length === 0) {
    logger.info(`[${label}] No resource owners to process`)
    return
  }

  const retentionDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  logger.info(
    `[${label}] Processing ${scope.ids.length} ${scope.kind} owners, cutoff: ${retentionDate.toISOString()}`
  )

  const doomedChats = await selectRowsByIdChunks(scope.ids, (chunkIds, chunkLimit) =>
    cleanupDb
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(
          cleanupOwnerCondition(copilotChats, scope, chunkIds),
          lt(copilotChats.updatedAt, retentionDate)
        )
      )
      .limit(chunkLimit)
  )

  const doomedChatIds = doomedChats.map((c) => c.id)

  /** Collect external chat data before deleting the owning rows. */
  const chatCleanup = await prepareChatCleanup(doomedChatIds, label)

  /** Delete run children before their parent runs. Organization chats have no workspace runs. */
  const runChildResults = await cleanupRunChildren(workspaceIds, retentionDate, label)
  for (const r of runChildResults) {
    if (r.deleted > 0) logger.info(`[${r.table}] ${r.deleted} deleted`)
  }

  const runsResult =
    scope.kind === 'workspace'
      ? await batchDeleteByWorkspaceAndTimestamp({
          tableDef: copilotRuns,
          workspaceIdCol: copilotRuns.workspaceId,
          timestampCol: copilotRuns.updatedAt,
          workspaceIds,
          retentionDate,
          tableName: `${label}/copilotRuns`,
          dbClient: cleanupDb,
        })
      : { deleted: 0, failed: 0 }

  /**
   * Delete the selected chats only if their owner and cutoff still match.
   * Restored chats survive; external cleanup rechecks row existence as well.
   * Messages and feedback cascade only for chats actually deleted.
   */
  const chatsResult = { deleted: 0, failed: 0 }
  for (const batch of chunkArray(doomedChatIds, DEFAULT_DELETE_CHUNK_SIZE)) {
    try {
      const deleted = await cleanupDb
        .delete(copilotChats)
        .where(
          and(
            inArray(copilotChats.id, batch),
            cleanupOwnerCondition(copilotChats, scope),
            lt(copilotChats.updatedAt, retentionDate)
          )
        )
        .returning({ id: copilotChats.id })
      chatsResult.deleted += deleted.length
    } catch (error) {
      chatsResult.failed += batch.length
      logger.error(`[${label}/copilotChats] Chat retention delete failed`, { error })
    }
  }

  const inboxResult =
    scope.kind === 'workspace'
      ? await batchDeleteByWorkspaceAndTimestamp({
          tableDef: mothershipInboxTask,
          workspaceIdCol: mothershipInboxTask.workspaceId,
          timestampCol: mothershipInboxTask.createdAt,
          workspaceIds,
          retentionDate,
          tableName: `${label}/mothershipInboxTask`,
          dbClient: cleanupDb,
        })
      : { deleted: 0, failed: 0 }

  const totalDeleted =
    runChildResults.reduce((s, r) => s + r.deleted, 0) +
    runsResult.deleted +
    chatsResult.deleted +
    inboxResult.deleted

  logger.info(`[${label}] Complete: ${totalDeleted} total rows deleted`)

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

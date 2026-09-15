import type { BoundedCleanup } from '@/lib/cleanup/bounded'
import { deleteBoundedStorage } from '@/lib/cleanup/bounded-storage'
import type { CleanupType } from '@/lib/cleanup/bounded-types'

type BoundedChatCleanup = { control: BoundedCleanup; type: CleanupType }

import { dbFor } from '@sim/db'
import { copilotChats, copilotMessages, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { and, inArray, isNull } from 'drizzle-orm'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('ChatCleanup')

/** Chat cleanup only ever runs from cleanup jobs, so its reads use the cleanup pool. */
const cleanupDb = dbFor('cleanup')

const COPILOT_CLEANUP_BATCH_SIZE = 1000
/** Bounds how many chats' `copilot_messages` rows are scanned per query. */
const CHAT_FILE_COLLECT_CHUNK_SIZE = 500

/**
 * Only storage in these contexts is tied to chat/task lifecycle. Workspace
 * files, execution logs, knowledge bases, profile pictures, etc. are owned by
 * other subsystems and must never be touched by chat cleanup — even if a row
 * somehow ends up with `chatId` set through a future flow.
 */
const CHAT_SCOPED_CONTEXTS = ['copilot', 'mothership'] as const satisfies readonly StorageContext[]
type ChatScopedContext = (typeof CHAT_SCOPED_CONTEXTS)[number]

interface FileRef {
  key: string
  context: ChatScopedContext
  chatId: string
}

/**
 * Collect all file storage keys for the given chat IDs from two sources:
 * 1. workspaceFiles rows with chatId FK (chat-scoped contexts only)
 * 2. fileAttachments[].key inside each copilot_messages.content
 */
export async function collectChatFiles(
  chatIds: string[],
  bounded?: BoundedChatCleanup
): Promise<FileRef[]> {
  const files: FileRef[] = []
  if (chatIds.length === 0) return files

  const seen = new Set<string>()

  for (const chunk of chunkArray(
    chatIds,
    bounded?.control.options.batchSize ?? CHAT_FILE_COLLECT_CHUNK_SIZE
  )) {
    bounded?.control.assertTimeRemaining()
    const selectFiles = async (executor: Pick<typeof cleanupDb, 'select'>) =>
      Promise.all([
        executor
          .select({
            key: workspaceFiles.key,
            context: workspaceFiles.context,
            chatId: workspaceFiles.chatId,
          })
          .from(workspaceFiles)
          .where(
            and(
              inArray(workspaceFiles.chatId, chunk),
              isNull(workspaceFiles.deletedAt),
              inArray(workspaceFiles.context, [...CHAT_SCOPED_CONTEXTS])
            )
          ),
        // Scan every message row for the chat (no deleted_at filter): this is a
        // deletion path collecting blob keys, so attachments on any row count.
        executor
          .select({ content: copilotMessages.content, chatId: copilotMessages.chatId })
          .from(copilotMessages)
          .where(inArray(copilotMessages.chatId, chunk)),
      ])

    const [linkedFiles, messageRows] = await (bounded
      ? bounded.control.query(selectFiles)
      : selectFiles(cleanupDb))

    for (const f of linkedFiles) {
      if (f.chatId && !seen.has(f.key)) {
        seen.add(f.key)
        files.push({ key: f.key, context: f.context as ChatScopedContext, chatId: f.chatId })
      }
    }

    for (const row of messageRows) {
      const msg = row.content
      if (!msg || typeof msg !== 'object') continue
      const attachments = (msg as Record<string, unknown>).fileAttachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (
          attachment &&
          typeof attachment === 'object' &&
          (attachment as Record<string, unknown>).key
        ) {
          const key = (attachment as Record<string, unknown>).key as string
          if (!seen.has(key)) {
            seen.add(key)
            files.push({ key, context: 'copilot', chatId: row.chatId })
          }
        }
      }
    }
  }

  return files
}

/** Groups files by storage context so each context can use one batch DELETE call. */
export async function deleteStorageFiles(
  files: FileRef[],
  label: string
): Promise<{ filesDeleted: number; filesFailed: number }> {
  const stats = { filesDeleted: 0, filesFailed: 0 }
  if (files.length === 0 || !isUsingCloudStorage()) return stats

  const keysByContext = new Map<ChatScopedContext, string[]>()
  for (const file of files) {
    const bucket = keysByContext.get(file.context)
    if (bucket) bucket.push(file.key)
    else keysByContext.set(file.context, [file.key])
  }

  for (const [context, keys] of keysByContext) {
    const result = await StorageService.deleteFiles(keys, context)
    stats.filesDeleted += result.deleted
    stats.filesFailed += result.failed.length
    for (const { key, error } of result.failed) {
      logger.error(`[${label}] Failed to delete storage file ${key} (context: ${context}):`, {
        error,
      })
    }
  }

  return stats
}

/**
 * Call the copilot backend to delete chat data (memory_files, checkpoints, task_chains, etc.)
 * Chunked at 1000 per request.
 */
export async function cleanupCopilotBackend(
  chatIds: string[],
  label: string,
  bounded?: BoundedChatCleanup
): Promise<{ deleted: number; failed: number }> {
  const stats = { deleted: 0, failed: 0 }

  if (bounded && chatIds.length > 0 && !env.COPILOT_API_KEY)
    throw new Error('COPILOT_API_KEY is required for bounded chat cleanup')
  if (chatIds.length === 0 || !env.COPILOT_API_KEY) {
    if (!env.COPILOT_API_KEY) {
      logger.warn(`[${label}] COPILOT_API_KEY not set, skipping copilot backend cleanup`)
    }
    return stats
  }

  const batchSize = bounded?.control.options.batchSize ?? COPILOT_CLEANUP_BATCH_SIZE
  for (let i = 0; i < chatIds.length; i += batchSize) {
    const chunk = chatIds.slice(i, i + batchSize)
    try {
      const response = await fetch(`${SIM_AGENT_API_URL}/api/tasks/cleanup`, {
        method: 'POST',
        ...(bounded ? { signal: AbortSignal.timeout(10_000) } : {}),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.COPILOT_API_KEY,
        },
        body: JSON.stringify({ chatIds: chunk }),
      })

      if (!response.ok) {
        if (bounded) throw new Error(`Copilot backend cleanup failed: ${response.status}`)
        const errorBody = await response.text().catch(() => '')
        logger.error(`[${label}] Copilot backend cleanup failed: ${response.status}`, {
          errorBody,
          chatCount: chunk.length,
        })
        stats.failed += chunk.length
        continue
      }

      const result = await response.json()
      if (
        bounded &&
        (!Number.isInteger(result.deleted) || result.deleted < 0 || (result.failed ?? 0) > 0)
      )
        throw new Error('Invalid or failed Copilot backend cleanup result')
      stats.deleted += result.deleted ?? 0
      logger.info(
        `[${label}] Copilot backend cleanup: ${result.deleted} chats deleted (batch ${Math.floor(i / COPILOT_CLEANUP_BATCH_SIZE) + 1})`
      )
    } catch (error) {
      if (bounded) throw error
      stats.failed += chunk.length
      logger.error(`[${label}] Copilot backend cleanup request failed:`, { error })
    }
  }

  return stats
}

/**
 * Full chat cleanup: collect file refs, then (after DB deletion by caller)
 * call copilot backend and delete storage files.
 *
 * Usage:
 *   const cleanup = await prepareChatCleanup(chatIds, label)
 *   // ... delete DB rows ...
 *   await cleanup.execute()
 */
export async function prepareChatCleanup(
  chatIds: string[],
  label: string,
  bounded?: BoundedChatCleanup
): Promise<{ execute: () => Promise<void> }> {
  // Collect file refs BEFORE DB deletion (keys + context are lost after cascade)
  if (bounded && chatIds.length > 0 && !env.COPILOT_API_KEY)
    throw new Error('COPILOT_API_KEY is required for bounded chat cleanup')
  const files = await collectChatFiles(chatIds, bounded)
  if (files.length > 0) {
    logger.info(`[${label}] Collected ${files.length} files for cleanup`, {
      files: files.map((f) => ({ key: f.key, context: f.context })),
    })
  }

  return {
    execute: async () => {
      // A chat can be restored (or its delete can fail) between selection and
      // the caller's row delete. Purge backend data and files only for chats
      // whose rows are actually gone, so a surviving row never loses its data.
      const survivors = new Set<string>()
      for (const chunk of chunkArray(
        chatIds,
        bounded?.control.options.batchSize ?? CHAT_FILE_COLLECT_CHUNK_SIZE
      )) {
        const selectSurvivors = async (executor: Pick<typeof cleanupDb, 'select'>) =>
          executor
            .select({ id: copilotChats.id })
            .from(copilotChats)
            .where(inArray(copilotChats.id, chunk))
        const rows = await (bounded
          ? bounded.control.query(selectSurvivors)
          : selectSurvivors(cleanupDb))
        for (const row of rows) survivors.add(row.id)
      }
      if (survivors.size > 0) {
        logger.info(
          `[${label}] Skipping external cleanup for ${survivors.size} chats whose rows still exist`
        )
      }
      const confirmedChatIds = chatIds.filter((id) => !survivors.has(id))
      const confirmedFiles = files.filter((file) => !survivors.has(file.chatId))

      // Call copilot backend
      if (confirmedChatIds.length > 0) {
        const copilotResult = await cleanupCopilotBackend(confirmedChatIds, label, bounded)
        logger.info(
          `[${label}] Copilot backend: ${copilotResult.deleted} deleted, ${copilotResult.failed} failed`
        )
      }

      // Delete storage files with correct context per file
      if (confirmedFiles.length > 0) {
        if (bounded) {
          for (const context of CHAT_SCOPED_CONTEXTS) {
            await deleteBoundedStorage(
              bounded.control,
              bounded.type,
              confirmedFiles.filter((file) => file.context === context).map((file) => file.key),
              context
            )
          }
          return
        }
        const fileStats = await deleteStorageFiles(confirmedFiles, label)
        logger.info(
          `[${label}] Storage cleanup: ${fileStats.filesDeleted} deleted, ${fileStats.filesFailed} failed`
        )
      }
    },
  }
}

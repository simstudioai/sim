import { db } from '@sim/db'
import { copilotChats, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, inArray, isNull } from 'drizzle-orm'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env } from '@/lib/core/config/env'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('ChatCleanup')

const COPILOT_CLEANUP_BATCH_SIZE = 1000

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
}

/**
 * Collect all file storage keys associated with the given chat IDs.
 * Two sources:
 * 1. workspaceFiles rows with chatId FK — filtered to chat-scoped contexts only
 * 2. fileAttachments[].key inside copilotChats.messages JSONB — all copilot uploads
 */
export async function collectChatFiles(chatIds: string[]): Promise<FileRef[]> {
  const files: FileRef[] = []
  if (chatIds.length === 0) return files

  const seen = new Set<string>()

  const [linkedFiles, chatsWithMessages] = await Promise.all([
    db
      .select({ key: workspaceFiles.key, context: workspaceFiles.context })
      .from(workspaceFiles)
      .where(
        and(
          inArray(workspaceFiles.chatId, chatIds),
          isNull(workspaceFiles.deletedAt),
          inArray(workspaceFiles.context, [...CHAT_SCOPED_CONTEXTS])
        )
      ),
    db
      .select({ messages: copilotChats.messages })
      .from(copilotChats)
      .where(inArray(copilotChats.id, chatIds)),
  ])

  for (const f of linkedFiles) {
    if (!seen.has(f.key)) {
      seen.add(f.key)
      files.push({ key: f.key, context: f.context as ChatScopedContext })
    }
  }

  for (const chat of chatsWithMessages) {
    const messages = chat.messages as unknown[]
    if (!Array.isArray(messages)) continue
    for (const msg of messages) {
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
            files.push({ key, context: 'copilot' })
          }
        }
      }
    }
  }

  return files
}

/**
 * Delete files from cloud storage using the correct context/bucket per file.
 */
export async function deleteStorageFiles(
  files: FileRef[],
  label: string
): Promise<{ filesDeleted: number; filesFailed: number }> {
  const stats = { filesDeleted: 0, filesFailed: 0 }
  if (files.length === 0 || !isUsingCloudStorage()) return stats

  await Promise.all(
    files.map(async (file) => {
      try {
        await StorageService.deleteFile({ key: file.key, context: file.context })
        stats.filesDeleted++
      } catch (error) {
        stats.filesFailed++
        logger.error(`[${label}] Failed to delete storage file ${file.key}:`, { error })
      }
    })
  )

  return stats
}

/**
 * Call the copilot backend to delete chat data (memory_files, checkpoints, task_chains, etc.)
 * Chunked at 1000 per request.
 */
export async function cleanupCopilotBackend(
  chatIds: string[],
  label: string
): Promise<{ deleted: number; failed: number }> {
  const stats = { deleted: 0, failed: 0 }

  if (chatIds.length === 0 || !env.COPILOT_API_KEY) {
    if (!env.COPILOT_API_KEY) {
      logger.warn(`[${label}] COPILOT_API_KEY not set, skipping copilot backend cleanup`)
    }
    return stats
  }

  for (let i = 0; i < chatIds.length; i += COPILOT_CLEANUP_BATCH_SIZE) {
    const chunk = chatIds.slice(i, i + COPILOT_CLEANUP_BATCH_SIZE)
    try {
      const response = await fetch(`${SIM_AGENT_API_URL}/api/tasks/cleanup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.COPILOT_API_KEY,
        },
        body: JSON.stringify({ chatIds: chunk }),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        logger.error(`[${label}] Copilot backend cleanup failed: ${response.status}`, {
          errorBody,
          chatCount: chunk.length,
        })
        stats.failed += chunk.length
        continue
      }

      const result = await response.json()
      stats.deleted += result.deleted ?? 0
      logger.info(
        `[${label}] Copilot backend cleanup: ${result.deleted} chats deleted (batch ${Math.floor(i / COPILOT_CLEANUP_BATCH_SIZE) + 1})`
      )
    } catch (error) {
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
  label: string
): Promise<{ execute: () => Promise<void> }> {
  // Collect file refs BEFORE DB deletion (keys + context are lost after cascade)
  const files = await collectChatFiles(chatIds)
  if (files.length > 0) {
    logger.info(`[${label}] Collected ${files.length} files for cleanup`, {
      files: files.map((f) => ({ key: f.key, context: f.context })),
    })
  }

  return {
    execute: async () => {
      // Call copilot backend
      if (chatIds.length > 0) {
        const copilotResult = await cleanupCopilotBackend(chatIds, label)
        logger.info(
          `[${label}] Copilot backend: ${copilotResult.deleted} deleted, ${copilotResult.failed} failed`
        )
      }

      // Delete storage files with correct context per file
      if (files.length > 0) {
        const fileStats = await deleteStorageFiles(files, label)
        logger.info(
          `[${label}] Storage cleanup: ${fileStats.filesDeleted} deleted, ${fileStats.filesFailed} failed`
        )
      }
    },
  }
}

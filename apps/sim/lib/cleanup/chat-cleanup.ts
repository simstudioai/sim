import { dbFor } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import {
  type ChatFileRef,
  type ChatScopedContext,
  collectChatFiles,
} from '@/lib/cleanup/chat-files'
import { env } from '@/lib/core/config/env'
import { SIM_AGENT_API_URL } from '@/lib/mothership/constants'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('ChatCleanup')

/** Chat cleanup's reads use the cleanup pool so a purge never waits on the request pool. */
const cleanupDb = dbFor('cleanup')

const COPILOT_CLEANUP_BATCH_SIZE = 1000
/** Bounds how many keys or chat ids one query names. */
const CHAT_FILE_COLLECT_CHUNK_SIZE = 500

/**
 * Organization attachment keys that a remaining chat still references, so they outlive the
 * chats being purged. Runs after the caller deleted those chats' rows, so any match is
 * another chat: a fork, or a chat that is only soft-deleted and may be restored.
 */
export async function organizationAttachmentsStillReferenced(
  files: readonly ChatFileRef[]
): Promise<Set<string>> {
  const keysByOrganization = new Map<string, string[]>()
  for (const file of files) {
    if (!file.organizationId) continue
    const keys = keysByOrganization.get(file.organizationId)
    if (keys) keys.push(file.key)
    else keysByOrganization.set(file.organizationId, [file.key])
  }
  const referenced = new Set<string>()
  for (const [organizationId, keys] of keysByOrganization) {
    for (const chunk of chunkArray(keys, CHAT_FILE_COLLECT_CHUNK_SIZE)) {
      const wanted = new Set(chunk)
      const rows = await cleanupDb
        .select({ fileAttachments: sql<unknown>`${copilotMessages.content} -> 'fileAttachments'` })
        .from(copilotMessages)
        .innerJoin(copilotChats, eq(copilotChats.id, copilotMessages.chatId))
        .where(
          and(
            eq(copilotChats.organizationId, organizationId),
            or(
              ...chunk.map(
                (key) =>
                  sql`${copilotMessages.content} @> ${JSON.stringify({ fileAttachments: [{ key }] })}::jsonb`
              )
            )
          )
        )
      for (const { fileAttachments } of rows) {
        if (!Array.isArray(fileAttachments)) continue
        for (const attachment of fileAttachments) {
          if (
            isRecordLike(attachment) &&
            typeof attachment.key === 'string' &&
            wanted.has(attachment.key)
          )
            referenced.add(attachment.key)
        }
      }
    }
  }
  return referenced
}

/** Groups files by storage context so each context can use one batch DELETE call. */
export async function deleteStorageFiles(
  files: ChatFileRef[],
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
      // A chat can be restored (or its delete can fail) between selection and
      // the caller's row delete. Purge backend data and files only for chats
      // whose rows are actually gone, so a surviving row never loses its data.
      const survivors = new Set<string>()
      for (const chunk of chunkArray(chatIds, CHAT_FILE_COLLECT_CHUNK_SIZE)) {
        const rows = await cleanupDb
          .select({ id: copilotChats.id })
          .from(copilotChats)
          .where(inArray(copilotChats.id, chunk))
        for (const row of rows) survivors.add(row.id)
      }
      if (survivors.size > 0) {
        logger.info(
          `[${label}] Skipping external cleanup for ${survivors.size} chats whose rows still exist`
        )
      }
      const confirmedChatIds = chatIds.filter((id) => !survivors.has(id))
      const sharedKeys = await organizationAttachmentsStillReferenced(
        files.filter((file) => !survivors.has(file.chatId))
      )
      const confirmedFiles = files.filter(
        (file) => !survivors.has(file.chatId) && !sharedKeys.has(file.key)
      )

      // Call copilot backend
      if (confirmedChatIds.length > 0) {
        const copilotResult = await cleanupCopilotBackend(confirmedChatIds, label)
        logger.info(
          `[${label}] Copilot backend: ${copilotResult.deleted} deleted, ${copilotResult.failed} failed`
        )
      }

      // Delete storage files with correct context per file
      if (confirmedFiles.length > 0) {
        const fileStats = await deleteStorageFiles(confirmedFiles, label)
        logger.info(
          `[${label}] Storage cleanup: ${fileStats.filesDeleted} deleted, ${fileStats.filesFailed} failed`
        )
      }
    },
  }
}

import { dbFor } from '@sim/db'
import { copilotChats, copilotMessages } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { eq, inArray, sql } from 'drizzle-orm'
import { enqueueChatInlineImageCleanup } from '@/lib/cleanup/chat-backend-cleanup'
import {
  CHAT_FILE_COLLECT_CHUNK_SIZE,
  type ChatFileRef,
  type ChatFileReferenceScope,
  type ChatScopedContext,
  chatFileReferenceScope,
  collectChatFiles,
} from '@/lib/cleanup/chat-files'
import { env } from '@/lib/core/config/env'
import { SIM_AGENT_API_URL } from '@/lib/mothership/constants'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

const logger = createLogger('ChatCleanup')

/** Chat cleanup's reads use the cleanup pool so a purge never waits on the request pool. */
const cleanupDb = dbFor('cleanup')

const COPILOT_CLEANUP_BATCH_SIZE = 1000

/**
 * The keys among `keys` that some chat of `scope` names in its messages' `fileAttachments`, in one
 * scan of the scope's messages. The keys travel as one JSON parameter, so their number never
 * meets the bind limit. A scope with no chat left is not scanned.
 */
async function keysReferencedInScope(
  scope: ChatFileReferenceScope,
  keys: readonly string[]
): Promise<string[]> {
  const inScope =
    scope.kind === 'organization'
      ? eq(copilotChats.organizationId, scope.id)
      : eq(copilotChats.workspaceId, scope.id)
  const [anyChat] = await cleanupDb
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(inScope)
    .limit(1)
  if (!anyChat) return []
  const attachments = sql`${copilotMessages.content} -> 'fileAttachments'`
  const rows = await cleanupDb.execute<{ key: string }>(sql`
    SELECT DISTINCT attachment ->> 'key' AS key
    FROM ${copilotMessages}
    JOIN ${copilotChats} ON ${copilotChats.id} = ${copilotMessages.chatId}
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(${attachments}) = 'array' THEN ${attachments} ELSE '[]'::jsonb END
    ) AS attachment
    WHERE ${inScope}
      AND jsonb_typeof(attachment -> 'key') = 'string'
      AND attachment ->> 'key' IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
  `)
  return rows.map((row) => row.key)
}

/**
 * The files among `files` that may be deleted: those no remaining chat of their scope still
 * references ({@link ChatFileRef}), checked with one query per scope. A key whose scope is unknown
 * is kept rather than risked. Runs after the caller deleted those chats' rows, so any match is
 * another chat: a fork, or a chat that is only soft-deleted and may be restored.
 */
export async function deletableChatFiles(files: readonly ChatFileRef[]): Promise<ChatFileRef[]> {
  const keysByScope = new Map<string, { scope: ChatFileReferenceScope; keys: string[] }>()
  const unknown = new Set<string>()
  for (const file of files) {
    const scope = chatFileReferenceScope(file)
    if (scope === 'unshared') continue
    if (scope === 'unknown') {
      unknown.add(file.key)
      continue
    }
    const scopeKey = `${scope.kind}:${scope.id}`
    const group = keysByScope.get(scopeKey)
    if (group) group.keys.push(file.key)
    else keysByScope.set(scopeKey, { scope, keys: [file.key] })
  }
  if (unknown.size > 0) {
    logger.warn(`Keeping ${unknown.size} chat files whose reference scope is unknown`, {
      keys: [...unknown],
    })
  }
  const kept = new Set(unknown)
  for (const { scope, keys } of keysByScope.values()) {
    for (const key of await keysReferencedInScope(scope, [...new Set(keys)])) kept.add(key)
  }
  return files.filter((file) => !kept.has(file.key))
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
 * call copilot backend, delete storage files, and queue the chats' inline image sweep.
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
      const confirmedFiles = await deletableChatFiles(
        files.filter((file) => !survivors.has(file.chatId))
      )

      // Call copilot backend
      if (confirmedChatIds.length > 0) {
        const copilotResult = await cleanupCopilotBackend(confirmedChatIds, label)
        logger.info(
          `[${label}] Copilot backend: ${copilotResult.deleted} deleted, ${copilotResult.failed} failed`
        )
        await enqueueChatInlineImageCleanup(cleanupDb, confirmedChatIds)
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

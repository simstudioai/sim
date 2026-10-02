import { dbFor } from '@sim/db'
import { copilotChats, copilotMessages, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import {
  inlineChatImageKey,
  inlineChatImageReferences,
} from '@/lib/mothership/chat/inline-image-key'
import { SIM_AGENT_API_URL } from '@/lib/mothership/constants'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import { tryInferContextFromKey } from '@/lib/uploads/utils/file-utils'

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
  /**
   * An organization Chat attachment (`assistant/<orgId>/…`): no `workspace_files` row owns it,
   * and a fork carries the same key, so it is deleted only once no remaining chat of that
   * organization references it.
   */
  organizationId?: string
}

/** The organization an `assistant/<orgId>/…` attachment key was uploaded under. */
function organizationAttachmentOwner(key: string): string | undefined {
  if (tryInferContextFromKey(key) !== 'mothership') return undefined
  const [, organizationId] = key.split('/')
  return organizationId || undefined
}

/**
 * The chat images an assistant message published under its request id, keyed by chat id,
 * so they are purged with the chat. A row this cannot read as such a message has none.
 */
function inlineChatImageKeys(chatId: string, content: Record<string, unknown>): string[] {
  if (content.role !== 'assistant' || typeof content.requestId !== 'string') return []
  const published = inlineChatImageReferences({
    role: 'assistant',
    requestId: content.requestId,
    content: typeof content.content === 'string' ? content.content : '',
    contentBlocks: Array.isArray(content.contentBlocks)
      ? content.contentBlocks.flatMap((block) =>
          isRecordLike(block) && block.type === 'text' && typeof block.content === 'string'
            ? [{ type: 'text' as const, content: block.content }]
            : []
        )
      : undefined,
  })
  if (!published) return []
  const keys: string[] = []
  for (const reference of published.references) {
    try {
      keys.push(inlineChatImageKey(chatId, published.requestId, reference))
    } catch {
      // A chat or request id outside the key grammar never had an image stored under it.
    }
  }
  return keys
}

/**
 * Collect all file storage keys for the given chat IDs from three sources:
 * 1. workspaceFiles rows with chatId FK (chat-scoped contexts only)
 * 2. fileAttachments[].key inside each copilot_messages.content: copilot keys, and
 *    organization attachments under their own context (see {@link FileRef.organizationId})
 * 3. the chat-scoped inline images each assistant message published
 *
 * A workspace attachment is owned by its `workspace_files` row (source 1, or the workspace
 * file lifecycle), never by the message: a fork carries the same attachment when its copy
 * failed or its file was deleted, and the copilot bucket falls back to the workspace bucket
 * on GCS (and may be configured to it on S3), so deleting such a key as copilot storage
 * could delete a file another chat or the workspace still uses.
 */
export async function collectChatFiles(chatIds: string[]): Promise<FileRef[]> {
  const files: FileRef[] = []
  if (chatIds.length === 0) return files

  const seen = new Set<string>()

  for (const chunk of chunkArray(chatIds, CHAT_FILE_COLLECT_CHUNK_SIZE)) {
    const [linkedFiles, messageRows] = await Promise.all([
      cleanupDb
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
      cleanupDb
        .select({ content: copilotMessages.content, chatId: copilotMessages.chatId })
        .from(copilotMessages)
        .where(inArray(copilotMessages.chatId, chunk)),
    ])

    for (const f of linkedFiles) {
      if (f.chatId && !seen.has(f.key)) {
        seen.add(f.key)
        files.push({ key: f.key, context: f.context as ChatScopedContext, chatId: f.chatId })
      }
    }

    for (const row of messageRows) {
      const msg = row.content
      if (!msg || typeof msg !== 'object') continue
      for (const key of inlineChatImageKeys(row.chatId, msg as Record<string, unknown>)) {
        if (!seen.has(key)) {
          seen.add(key)
          files.push({ key, context: 'mothership', chatId: row.chatId })
        }
      }
      const attachments = (msg as Record<string, unknown>).fileAttachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (
          attachment &&
          typeof attachment === 'object' &&
          (attachment as Record<string, unknown>).key
        ) {
          const key = (attachment as Record<string, unknown>).key as string
          if (seen.has(key)) continue
          const organizationId = organizationAttachmentOwner(key)
          if (organizationId) {
            seen.add(key)
            files.push({ key, context: 'mothership', chatId: row.chatId, organizationId })
          } else if (tryInferContextFromKey(key) === 'copilot') {
            seen.add(key)
            files.push({ key, context: 'copilot', chatId: row.chatId })
          }
        }
      }
    }
  }

  return files
}

/**
 * Organization attachment keys that a remaining chat still references, so they outlive the
 * chats being purged. Runs after the caller deleted those chats' rows, so any match is
 * another chat: a fork, or a chat that is only soft-deleted and may be restored.
 */
async function organizationAttachmentsStillReferenced(files: FileRef[]): Promise<Set<string>> {
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
        .select({ content: copilotMessages.content })
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
      for (const { content } of rows) {
        const attachments = isRecordLike(content) ? content.fileAttachments : undefined
        if (!Array.isArray(attachments)) continue
        for (const attachment of attachments) {
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

import { dbFor } from '@sim/db'
import { copilotMessages, workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  inlineChatImageKey,
  inlineChatImageReferences,
} from '@/lib/mothership/chat/inline-image-key'
import { detoastedMessageContent, textMessageContent } from '@/lib/mothership/chat/text-transcript'
import type { StorageContext } from '@/lib/uploads'
import { tryInferContextFromKey } from '@/lib/uploads/utils/file'

/** File collection reads use the cleanup pool so a purge never waits on the request pool. */
const cleanupDb = dbFor('cleanup')

/** Bounds how many chats' `copilot_messages` rows are scanned per query. */
const CHAT_FILE_COLLECT_CHUNK_SIZE = 500

/**
 * Only storage in these contexts is tied to chat/task lifecycle. Workspace
 * files, execution logs, knowledge bases, profile pictures, etc. are owned by
 * other subsystems and must never be touched by chat cleanup — even if a row
 * somehow ends up with `chatId` set through a future flow.
 */
const CHAT_SCOPED_CONTEXTS = ['copilot', 'mothership'] as const satisfies readonly StorageContext[]
export type ChatScopedContext = (typeof CHAT_SCOPED_CONTEXTS)[number]

/** A stored object that lives and dies with the chat named by `chatId`. */
export interface ChatFileRef {
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
 *    organization attachments under their own context (see {@link ChatFileRef.organizationId})
 * 3. the chat-scoped inline images each assistant message published
 *
 * A workspace attachment is owned by its `workspace_files` row (source 1, or the workspace
 * file lifecycle), never by the message: a fork carries the same attachment when its copy
 * failed or its file was deleted, and the copilot bucket falls back to the workspace bucket
 * on GCS (and may be configured to it on S3), so deleting such a key as copilot storage
 * could delete a file another chat or the workspace still uses.
 *
 * Reads through the cleanup pool unless `executor` is given, which a deletion passes to read the
 * keys inside its transaction once it holds the chat rows, so no row naming a key can commit
 * between this read and the delete.
 */
export async function collectChatFiles(
  chatIds: readonly string[],
  executor: DbOrTx = cleanupDb
): Promise<ChatFileRef[]> {
  const files: ChatFileRef[] = []
  if (chatIds.length === 0) return files

  const seen = new Set<string>()

  for (const chunk of chunkArray([...chatIds], CHAT_FILE_COLLECT_CHUNK_SIZE)) {
    const [linkedFiles, messageRows] = await Promise.all([
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
        .select({
          content: textMessageContent(['role', 'requestId', 'content', 'fileAttachments']),
          chatId: copilotMessages.chatId,
        })
        .from(copilotMessages)
        .crossJoinLateral(detoastedMessageContent)
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

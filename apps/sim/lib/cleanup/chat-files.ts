import { dbFor } from '@sim/db'
import { copilotChats, copilotMessages, workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { INLINE_CHAT_IMAGE_PREFIX } from '@/lib/mothership/chat/inline-image-reference'
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

/**
 * A stored object that lives and dies with the chat named by `chatId`. A fork keeps naming its
 * source's key wherever it did not copy the file (an organization attachment, a message-only
 * copilot attachment, or an upload whose copy failed), and a fork stays in its source's workspace
 * or organization, so the key is deleted only once no remaining chat of that scope references it
 * ({@link chatFileReferenceScope}).
 */
export interface ChatFileRef {
  key: string
  context: ChatScopedContext
  chatId: string
  /**
   * The organization whose chats may still reference the key: the one an organization Chat
   * attachment (`assistant/<orgId>/…`) was uploaded under, or the chat's own organization.
   */
  organizationId?: string
  /**
   * The workspace whose chats may still reference the key: its `workspace_files` row's
   * workspace, else the chat's. `null` when the chat had neither a workspace nor an organization,
   * which no fork can be made from. Absent on events queued before refs carried their scope.
   */
  workspaceId?: string | null
}

/** The chats a {@link ChatFileRef}'s key must be checked against before it is deleted. */
export type ChatFileReferenceScope =
  | { kind: 'organization'; id: string }
  | { kind: 'workspace'; id: string }

/** The organization an `assistant/<orgId>/…` attachment key was uploaded under. */
function organizationAttachmentOwner(key: string): string | undefined {
  if (tryInferContextFromKey(key) !== 'mothership') return undefined
  const [, organizationId] = key.split('/')
  return organizationId || undefined
}

/** The workspace a `workspace/<workspaceId>/…` upload key was written under. */
function workspaceUploadOwner(key: string): string | undefined {
  return /^workspace\/([a-f0-9-]{36})\//.exec(key)?.[1]
}

/**
 * Where other chats may still reference `file`'s key: a scope to check, `null` when no other chat
 * can (the chat had no workspace or organization, or the key is one of the chat's own inline
 * images, which a fork copies under its own id), or `undefined` when unknown. Only a ref from an
 * event queued before refs carried their scope can be unknown: its scope is recovered from the
 * key where the key names one, and otherwise the key is kept rather than risk deleting a file a
 * fork still shows.
 */
export function chatFileReferenceScope(
  file: ChatFileRef
): ChatFileReferenceScope | null | undefined {
  if (file.organizationId) return { kind: 'organization', id: file.organizationId }
  if (file.workspaceId) return { kind: 'workspace', id: file.workspaceId }
  if (file.workspaceId === null) return null
  const organizationId = organizationAttachmentOwner(file.key)
  if (organizationId) return { kind: 'organization', id: organizationId }
  const workspaceId = workspaceUploadOwner(file.key)
  if (workspaceId) return { kind: 'workspace', id: workspaceId }
  if (file.key.startsWith(`${INLINE_CHAT_IMAGE_PREFIX}${file.chatId}/`)) return null
  return undefined
}

/**
 * Collect all file storage keys for the given chat IDs from two sources:
 * 1. workspaceFiles rows with chatId FK (chat-scoped contexts only)
 * 2. fileAttachments[].key inside each copilot_messages.content: copilot keys, and
 *    organization attachments under their own context (see {@link ChatFileRef.organizationId})
 *
 * Each ref carries the scope whose chats may still reference it (see {@link ChatFileRef}).
 *
 * Inline chat images are not collected: they live under the chat's own
 * `chat-images/<chatId>/` prefix with no row naming them, and a turn can publish one after this
 * read, so the chat cleanup handler deletes that whole prefix once the chat's row is gone.
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
    const [chats, linkedFiles, messageRows] = await Promise.all([
      executor
        .select({
          id: copilotChats.id,
          workspaceId: copilotChats.workspaceId,
          organizationId: copilotChats.organizationId,
        })
        .from(copilotChats)
        .where(inArray(copilotChats.id, chunk)),
      executor
        .select({
          key: workspaceFiles.key,
          context: workspaceFiles.context,
          chatId: workspaceFiles.chatId,
          workspaceId: workspaceFiles.workspaceId,
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
          fileAttachments: sql<unknown>`${copilotMessages.content} -> 'fileAttachments'`,
          chatId: copilotMessages.chatId,
        })
        .from(copilotMessages)
        .where(inArray(copilotMessages.chatId, chunk)),
    ])

    const chatScopes = new Map(chats.map((chat) => [chat.id, chat]))
    /** The scope a key collected from `chatId` is checked in, preferring the file row's workspace. */
    const scopeOf = (
      chatId: string,
      fileWorkspaceId?: string | null
    ): Pick<ChatFileRef, 'organizationId' | 'workspaceId'> => {
      const chat = chatScopes.get(chatId)
      if (chat?.organizationId) return { organizationId: chat.organizationId }
      return { workspaceId: fileWorkspaceId ?? chat?.workspaceId ?? null }
    }

    for (const f of linkedFiles) {
      if (f.chatId && !seen.has(f.key)) {
        seen.add(f.key)
        files.push({
          key: f.key,
          context: f.context as ChatScopedContext,
          chatId: f.chatId,
          ...scopeOf(f.chatId, f.workspaceId),
        })
      }
    }

    for (const row of messageRows) {
      const attachments = row.fileAttachments
      if (!Array.isArray(attachments)) continue
      for (const attachment of attachments) {
        if (isRecordLike(attachment) && typeof attachment.key === 'string' && attachment.key) {
          const key = attachment.key
          if (seen.has(key)) continue
          const organizationId = organizationAttachmentOwner(key)
          if (organizationId) {
            seen.add(key)
            files.push({ key, context: 'mothership', chatId: row.chatId, organizationId })
          } else if (tryInferContextFromKey(key) === 'copilot') {
            seen.add(key)
            files.push({ key, context: 'copilot', chatId: row.chatId, ...scopeOf(row.chatId) })
          }
        }
      }
    }
  }

  return files
}

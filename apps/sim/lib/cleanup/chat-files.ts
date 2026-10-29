import { dbFor } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { and, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { inlineChatImagePrefix } from '@/lib/mothership/chat/inline-image-key'
import type { StorageContext } from '@/lib/uploads'
import { extractWorkspaceIdFromStorageKey, tryInferContextFromKey } from '@/lib/uploads/utils/file'

/** File collection reads use the cleanup pool so a purge never waits on the request pool. */
const cleanupDb = dbFor('cleanup')

/** Bounds how many chat ids or keys one chat cleanup query names. */
export const CHAT_FILE_COLLECT_CHUNK_SIZE = 500

/**
 * Only storage in these contexts is tied to chat/task lifecycle. Workspace
 * files, execution logs, knowledge bases, profile pictures, etc. are owned by
 * other subsystems and must never be touched by chat cleanup — even if a row
 * somehow ends up with `chatId` set through a future flow.
 */
const CHAT_SCOPED_CONTEXTS = ['copilot', 'mothership'] as const satisfies readonly StorageContext[]
export type ChatScopedContext = (typeof CHAT_SCOPED_CONTEXTS)[number]

/** The chats a {@link ChatFileRef}'s key must be checked against before it is deleted. */
export type ChatFileReferenceScope =
  | { kind: 'organization'; id: string }
  | { kind: 'workspace'; id: string }

/**
 * A stored object that lives and dies with the chat named by `chatId`. A fork keeps naming its
 * source's key wherever it did not copy the file (an organization attachment, a message-only
 * copilot attachment, or an upload whose copy failed), and a fork stays in its source's workspace
 * or organization, so the key is deleted only once no remaining chat of that scope names it in
 * its `fileAttachments`.
 */
export interface ChatFileRef {
  key: string
  context: ChatScopedContext
  chatId: string
  /**
   * The organization or workspace whose chats may still reference the key: an organization
   * attachment's organization, else the chat's organization, else the file row's or chat's
   * workspace. `null` when no other chat can reference it (the chat had neither, so no fork was
   * made from it). Absent only on events queued before refs carried their scope.
   */
  scope?: ChatFileReferenceScope | null
}

/** The organization an `assistant/<orgId>/…` attachment key was uploaded under. */
function organizationAttachmentOwner(key: string): string | undefined {
  if (tryInferContextFromKey(key) !== 'mothership') return undefined
  const [, organizationId] = key.split('/')
  return organizationId || undefined
}

/**
 * Which chats must be checked before `file`'s key is deleted: a scope, `unshared` when no other
 * chat can reference it, or `unknown`, in which case the key is kept rather than risk deleting a
 * file a fork still shows.
 */
export function chatFileReferenceScope(
  file: ChatFileRef
): ChatFileReferenceScope | 'unshared' | 'unknown' {
  if (file.scope !== undefined) return file.scope ?? 'unshared'
  // Legacy: refs queued before they carried their scope recover it from the key. Remove once
  // those events have drained.
  const organizationId = organizationAttachmentOwner(file.key)
  if (organizationId) return { kind: 'organization', id: organizationId }
  const workspaceId = extractWorkspaceIdFromStorageKey(file.key)
  if (workspaceId) return { kind: 'workspace', id: workspaceId }
  // A fork copies the source's inline images under its own id, so the chat's own are unshared.
  const ownImages = inlineChatImagePrefix(file.chatId)
  if (ownImages && file.key.startsWith(ownImages)) return 'unshared'
  return 'unknown'
}

/** The string keys of a message's `fileAttachments`; anything else names no stored file. */
function fileAttachmentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((attachment) =>
    isRecordLike(attachment) && typeof attachment.key === 'string' && attachment.key
      ? [attachment.key]
      : []
  )
}

/**
 * The keys among `keys` that no workspace file row, legacy file row or file version names, live
 * or soft-deleted, in one query.
 */
async function keysWithoutFileRow(executor: DbOrTx, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return []
  const rows = await executor.execute<{ key: string }>(sql`
    SELECT candidate AS key
    FROM jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb) AS candidate
    WHERE NOT EXISTS (SELECT 1 FROM ${workspaceFiles} WHERE ${workspaceFiles.key} = candidate)
      AND NOT EXISTS (SELECT 1 FROM ${workspaceFile} WHERE ${workspaceFile.key} = candidate)
      AND NOT EXISTS (
        SELECT 1 FROM ${workspaceFileVersion} WHERE ${workspaceFileVersion.key} = candidate
      )
  `)
  return rows.map((row) => row.key)
}

/**
 * Collect all file storage keys for the given chat IDs from two sources:
 * 1. workspaceFiles rows with chatId FK (chat-scoped contexts only)
 * 2. fileAttachments[].key inside each copilot_messages.content: copilot keys, organization
 *    attachments (`assistant/<orgId>/…`) under their own context, and `workspace/<ws>/…` uploads
 *    no file row names at all
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
 * could delete a file another chat or the workspace still uses. Only once no row names the key
 * at all (a soft-deleted row can still be restored) does the message own it: a fork kept the
 * upload past its source chat, whose row cascaded away, so the last chat attaching it collects
 * it, and the reference check keeps it while another chat of that workspace still attaches it.
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
    ): ChatFileReferenceScope | null => {
      const chat = chatScopes.get(chatId)
      if (chat?.organizationId) return { kind: 'organization', id: chat.organizationId }
      const workspaceId = fileWorkspaceId ?? chat?.workspaceId
      return workspaceId ? { kind: 'workspace', id: workspaceId } : null
    }

    for (const f of linkedFiles) {
      if (f.chatId && !seen.has(f.key)) {
        seen.add(f.key)
        files.push({
          key: f.key,
          context: f.context as ChatScopedContext,
          chatId: f.chatId,
          scope: scopeOf(f.chatId, f.workspaceId),
        })
      }
    }

    const unownedCandidates = new Map<string, { chatId: string; workspaceId: string }>()
    for (const row of messageRows) {
      for (const key of fileAttachmentKeys(row.fileAttachments)) {
        if (seen.has(key)) continue
        const uploadWorkspaceId = key.startsWith('workspace/')
          ? extractWorkspaceIdFromStorageKey(key)
          : null
        if (uploadWorkspaceId) {
          if (!unownedCandidates.has(key))
            unownedCandidates.set(key, { chatId: row.chatId, workspaceId: uploadWorkspaceId })
          continue
        }
        const organizationId = organizationAttachmentOwner(key)
        if (organizationId) {
          seen.add(key)
          files.push({
            key,
            context: 'mothership',
            chatId: row.chatId,
            scope: { kind: 'organization', id: organizationId },
          })
        } else if (tryInferContextFromKey(key) === 'copilot') {
          seen.add(key)
          files.push({ key, context: 'copilot', chatId: row.chatId, scope: scopeOf(row.chatId) })
        }
      }
    }

    for (const key of await keysWithoutFileRow(executor, [...unownedCandidates.keys()])) {
      const candidate = unownedCandidates.get(key)
      if (!candidate || seen.has(key)) continue
      seen.add(key)
      files.push({
        key,
        context: 'mothership',
        chatId: candidate.chatId,
        scope: { kind: 'workspace', id: candidate.workspaceId },
      })
    }
  }

  return files
}

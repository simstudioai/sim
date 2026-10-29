import { db } from '@sim/db'
import { copilotChats, workflow, workspace } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { CHAT_BACKEND_CLEANUP_EVENT } from '@/lib/cleanup/chat-backend-cleanup-event'
import {
  type ChatFileRef,
  type ChatScopedContext,
  collectChatFiles,
} from '@/lib/cleanup/chat-files'
import { env } from '@/lib/core/config/env'
import { enqueueOutboxEvents, MAX_BULK_ENQUEUE_EVENTS } from '@/lib/core/outbox/service'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

/** Most chat ids, or stored files, one cleanup event carries, so one handler run stays bounded. */
const CHAT_BACKEND_CLEANUP_BATCH_SIZE = 100

const chatIdSchema = z.string().min(1).max(255)

const chatFileSchema = z
  .object({
    key: z.string().min(1).max(1024),
    context: z.enum(['copilot', 'mothership'] satisfies [
      ChatScopedContext,
      ...ChatScopedContext[],
    ]),
    chatId: chatIdSchema,
    organizationId: chatIdSchema.optional(),
  })
  .strict()

export const chatBackendCleanupPayloadSchema = z
  .object({
    chatIds: z.array(chatIdSchema).max(CHAT_BACKEND_CLEANUP_BATCH_SIZE).default([]),
    files: z.array(chatFileSchema).max(CHAT_BACKEND_CLEANUP_BATCH_SIZE).default([]),
    /** Whether `chatIds` also reach the copilot backend; an event without it means they do. */
    copilotBackend: z.boolean().default(true),
    /** How many leading `chatIds` already had their inline image prefix swept; a checkpoint. */
    imagesSwept: z.number().int().min(0).max(CHAT_BACKEND_CLEANUP_BATCH_SIZE).default(0),
  })
  .strict()
  .refine((payload) => payload.chatIds.length > 0 || payload.files.length > 0, {
    message: 'A chat cleanup names at least one chat or stored file',
  })

type ChatBackendCleanupPayload = z.input<typeof chatBackendCleanupPayloadSchema>

/** What a chat deletion leaves outside Sim's rows: the chats' copilot backend data and stored files. */
export interface ChatCleanupTargets {
  chatIds: readonly string[]
  /** Read while the rows naming them exist; they cascade away with the chats. */
  files: readonly ChatFileRef[]
}

/**
 * Queues the purge of what the given chats leave outside Sim's rows once a delete cascades them
 * away: one bounded event per {@link CHAT_BACKEND_CLEANUP_BATCH_SIZE} chats, which sweeps each
 * chat's inline image prefix and purges its copilot backend data, and one per as many stored
 * files. Call it in the deleting transaction so the cleanup commits or rolls back with the delete;
 * the handler purges only chats whose rows are gone, so a chat the delete ends up sparing keeps its
 * data. A delete with no transaction to join queues it first, with an `availableAt` past the
 * moment the delete commits.
 *
 * Without `COPILOT_API_KEY` this Sim never reached a copilot backend, so the chats are queued for
 * their image sweep only; `copilotBackend: false` does the same for a caller that already purged
 * the backend itself.
 */
export async function enqueueChatBackendCleanup(
  executor: Pick<typeof db, 'insert'>,
  targets: ChatCleanupTargets,
  options: { availableAt?: Date; copilotBackend?: boolean } = {}
): Promise<void> {
  const chatIds = [...new Set(targets.chatIds)]
  const copilotBackend = (options.copilotBackend ?? true) && Boolean(env.COPILOT_API_KEY)
  const filesByKey = new Map<string, ChatFileRef>()
  for (const file of targets.files) if (!filesByKey.has(file.key)) filesByKey.set(file.key, file)
  const payloads: ChatBackendCleanupPayload[] = [
    ...chunkArray(chatIds, CHAT_BACKEND_CLEANUP_BATCH_SIZE).map((batch) => ({
      chatIds: batch,
      files: [],
      copilotBackend,
    })),
    ...chunkArray([...filesByKey.values()], CHAT_BACKEND_CLEANUP_BATCH_SIZE).map((batch) => ({
      chatIds: [],
      files: batch.map(({ key, context, chatId, organizationId }) => ({
        key,
        context,
        chatId,
        ...(organizationId ? { organizationId } : {}),
      })),
    })),
  ]
  for (const events of chunkArray(payloads, MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(executor, CHAT_BACKEND_CLEANUP_EVENT, events, {
      availableAt: options.availableAt,
    })
  }
}

/**
 * Reads, before an account removal's transaction, the chats it will cascade away and their stored
 * files, so the unbounded transcript scan behind the file keys never runs while the removal holds
 * the account and workspace locks. {@link enqueueAccountRemovalChatCleanupInTx} completes it.
 */
export async function readAccountRemovalChats(params: {
  userId: string
  workspaceIds: readonly string[]
}): Promise<ChatCleanupTargets> {
  const chatIds = await collectAccountRemovalChatIds(db, params)
  return { chatIds, files: await collectChatFiles(chatIds) }
}

/**
 * Queues the cleanup of every chat an account removal cascades away, inside its transaction:
 * the chat ids are re-read there, after the account row is locked, and the files of any chat
 * created since {@link readAccountRemovalChats} ran are read in the transaction. Every chat's inline
 * images go with its prefix sweep, however late they were written. An attachment a turn adds to
 * an already-read chat between that read and the removal's run stops is not collected here; when
 * it names one of the account's uploads, the account storage sweep still reclaims it, and
 * otherwise it stays behind.
 */
export async function enqueueAccountRemovalChatCleanupInTx(
  tx: DbTransaction,
  params: { userId: string; workspaceIds: readonly string[] },
  preRead: ChatCleanupTargets
): Promise<void> {
  const chatIds = await collectAccountRemovalChatIds(tx, params)
  const known = new Set(preRead.chatIds)
  const newChatFiles = await collectChatFiles(
    chatIds.filter((id) => !known.has(id)),
    tx
  )
  await enqueueChatBackendCleanup(tx, { chatIds, files: [...preRead.files, ...newChatFiles] })
}

/**
 * Every chat the removal of an account and the given workspaces cascades away: the account's own
 * chats, chats in those workspaces, and chats on workflows the account created or the workspaces
 * hold (`copilot_chats` cascades from `user`, `workspace` and `workflow`, and `workflow` from
 * `user` and `workspace`). A chat a handover later spares is skipped by the handler's re-check.
 */
async function collectAccountRemovalChatIds(
  executor: DbOrTx,
  params: { userId: string; workspaceIds: readonly string[] }
): Promise<string[]> {
  const workspaceIds = [...params.workspaceIds]
  const chatId = { id: copilotChats.id }
  const [own, onOwnWorkflows, ...inWorkspaces] = await Promise.all([
    executor.select(chatId).from(copilotChats).where(eq(copilotChats.userId, params.userId)),
    executor
      .select(chatId)
      .from(copilotChats)
      .innerJoin(workflow, eq(workflow.id, copilotChats.workflowId))
      .where(eq(workflow.userId, params.userId)),
    ...(workspaceIds.length > 0
      ? [
          executor
            .select(chatId)
            .from(copilotChats)
            .where(inArray(copilotChats.workspaceId, workspaceIds)),
          executor
            .select(chatId)
            .from(copilotChats)
            .innerJoin(workflow, eq(workflow.id, copilotChats.workflowId))
            .where(inArray(workflow.workspaceId, workspaceIds)),
        ]
      : []),
  ])
  return [...new Set([own, onOwnWorkflows, ...inWorkspaces].flat().map((row) => row.id))]
}

/** The workspaces a bare `DELETE FROM "user"` cascades away: every one the account owns. */
export async function ownedWorkspaceIds(executor: DbOrTx, userId: string): Promise<string[]> {
  const owned = await executor
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))
  return owned.map((row) => row.id)
}

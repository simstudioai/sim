import { db } from '@sim/db'
import {
  enqueueChatBackendCleanup,
  ownedWorkspaceIds,
  readAccountRemovalChats,
} from '@/lib/cleanup/chat-backend-cleanup'

/**
 * How long the cleanup an `/admin/remove-user` queues waits before it may run: well past any
 * user delete's commit, so the handler finds the cascaded chats gone. Purging a removed account
 * is not latency-sensitive, and a cleanup that runs while its delete is still in flight would
 * see the chats alive and purge nothing.
 */
const ADMIN_REMOVAL_CLEANUP_DELAY_MS = 60 * 60_000

/**
 * The user delete's `before` hook: `/admin/remove-user` cascades the account's chats, and those in
 * the workspaces it owns, away with no transaction to queue their cleanup in, so the cleanup is
 * queued now, before the delete, and delayed past it. The handler purges only chats whose rows
 * are gone, so a delete that fails or is refused purges nothing. A failed read or enqueue throws,
 * which aborts the removal rather than erasing chats whose cleanup nothing recorded. Better Auth's
 * delete runs outside any transaction this hook can join, so a chat or attachment written between
 * this read and that delete is not covered; account deletion, which owns its transaction, re-reads
 * under the account lock instead.
 */
export async function enqueueAdminRemovedChatCleanup(user: { id: string }): Promise<void> {
  const targets = await readAccountRemovalChats({
    userId: user.id,
    workspaceIds: await ownedWorkspaceIds(db, user.id),
  })
  if (targets.chatIds.length === 0) return
  await enqueueChatBackendCleanup(db, targets, {
    availableAt: new Date(Date.now() + ADMIN_REMOVAL_CLEANUP_DELAY_MS),
  })
}

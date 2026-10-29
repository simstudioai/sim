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
 * The user delete's `before` hook: queues, delayed past the delete, the cleanup of the chats
 * `/admin/remove-user` cascades away; a failed read or enqueue throws and aborts the removal. A
 * chat or attachment written between this read and Better Auth's delete is not covered.
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

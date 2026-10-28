import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  collectAccountRemovalChatIds,
  enqueueChatBackendCleanup,
  ownedWorkspaceIds,
} from '@/lib/cleanup/chat-backend-cleanup'

const logger = createLogger('AdminRemovalChatCleanup')

/** Chat ids read by {@link holdAdminRemovedChats}, keyed like the removal stops by the hook's user entity. */
const pendingChatIds = new WeakMap<object, string[]>()

/**
 * The user delete's `before` hook: `/admin/remove-user` cascades the account's chats, and those in
 * the workspaces it owns, away with no transaction to queue their copilot backend cleanup in, so
 * their ids are read now. A failed read lets the removal proceed rather than blocking an admin.
 */
export async function holdAdminRemovedChats(user: { id: string }): Promise<void> {
  try {
    pendingChatIds.set(
      user,
      await collectAccountRemovalChatIds(db, {
        userId: user.id,
        workspaceIds: await ownedWorkspaceIds(db, user.id),
      })
    )
  } catch (error) {
    logger.error('Failed to read the chats a user removal deletes', {
      userId: user.id,
      error: getErrorMessage(error),
    })
  }
}

/**
 * The user delete's `after` hook, once the delete has committed: queues the backend cleanup, which
 * purges only chats whose rows are gone. Never throws.
 */
export async function enqueueAdminRemovedChatCleanup(user: { id: string }): Promise<void> {
  const chatIds = pendingChatIds.get(user)
  pendingChatIds.delete(user)
  if (!chatIds?.length) return
  try {
    await enqueueChatBackendCleanup(db, chatIds)
  } catch (error) {
    logger.error('Failed to queue the backend cleanup of a removed user’s chats', {
      userId: user.id,
      chatCount: chatIds.length,
      error: getErrorMessage(error),
    })
  }
}

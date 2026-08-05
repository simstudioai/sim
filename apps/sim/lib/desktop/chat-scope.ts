import {
  activateBrowserScope,
  discardBrowserScope,
  migrateBrowserScope,
  suspendBrowserScope,
} from '@/lib/browser-agent/transport'
import {
  activateTerminalScope,
  discardTerminalScope,
  migrateTerminalScope,
  suspendTerminalScope,
} from '@/lib/terminal/transport'

/**
 * Prefix of the composer's provisional chat key, minted before the server
 * assigns a chat id. Deliberately distinct from the desktop scope prefix
 * (`pending:`, single colon) that {@link desktopChatScopeId} derives from it.
 */
export const PENDING_CHAT_KEY_PREFIX = 'pending::'

/**
 * Scope used by desktop-owned browser tabs and terminal processes.
 *
 * Persisted chats use their existing chat id directly. Before the first
 * message creates that row, the composer’s existing pending-chat key lets a resource be
 * opened and then migrated onto the assigned chat id without inventing a
 * second durable identity.
 */
export function desktopChatScopeId(
  workspaceId: string,
  chatId?: string,
  pendingChatKey?: string
): string {
  if (chatId) return chatId

  const pendingSuffix = pendingChatKey?.startsWith(PENDING_CHAT_KEY_PREFIX)
    ? pendingChatKey.slice(PENDING_CHAT_KEY_PREFIX.length)
    : undefined
  return `pending:${pendingSuffix || workspaceId}`
}

// A chat scope always covers both desktop surfaces. These pair helpers keep
// callers from ever operating on one surface and forgetting the other.

export async function activateDesktopChatScopes(scopeId: string): Promise<void> {
  await Promise.all([activateBrowserScope(scopeId), activateTerminalScope(scopeId)])
}

export async function discardDesktopChatScopes(scopeId: string): Promise<void> {
  await Promise.all([discardBrowserScope(scopeId), discardTerminalScope(scopeId)])
}

export async function migrateDesktopChatScopes(
  fromScopeId: string,
  toScopeId: string
): Promise<void> {
  await Promise.all([
    migrateBrowserScope(fromScopeId, toScopeId),
    migrateTerminalScope(fromScopeId, toScopeId),
  ])
}

/** Settles both suspensions — one surface failing must not skip the other. */
export async function suspendDesktopChatScopes(scopeId: string): Promise<void> {
  await Promise.allSettled([suspendBrowserScope(scopeId), suspendTerminalScope(scopeId)])
}

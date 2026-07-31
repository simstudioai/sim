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

  const pendingSuffix = pendingChatKey?.startsWith('pending::')
    ? pendingChatKey.slice('pending::'.length)
    : undefined
  return `pending:${pendingSuffix || workspaceId}`
}

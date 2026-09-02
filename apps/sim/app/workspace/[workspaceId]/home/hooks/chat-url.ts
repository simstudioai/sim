/**
 * The URL a new chat is handed off to once the server names it. The current
 * query string rides along so the composer's URL-backed state, the mode above
 * all, survives the path swap: the first Assistant message must not bounce the
 * person back to Build.
 */
export function chatUrl(workspaceId: string, chatId: string): string {
  return `/workspace/${workspaceId}/chat/${chatId}${window.location.search}`
}

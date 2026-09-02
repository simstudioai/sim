import { modeParam, resourceParam } from '@/app/workspace/[workspaceId]/home/search-params'

/** The composer's URL state that belongs on a chat page: the mode and the open resource. */
const CHAT_URL_PARAMS = [modeParam.key, resourceParam.key] as const

/**
 * The URL a new chat is handed off to once the server names it. Only the
 * params that belong on a chat ride along, so the mode survives the path swap
 * (the first Assistant message must not bounce the person back to Build) while
 * a search's `q` and filters, which never join a transcript, are left behind
 * whatever the URL held at that instant.
 */
export function chatUrl(workspaceId: string, chatId: string): string {
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  for (const key of CHAT_URL_PARAMS) {
    const value = current.get(key)
    if (value) carried.set(key, value)
  }
  const search = carried.toString()
  return `/workspace/${workspaceId}/chat/${chatId}${search ? `?${search}` : ''}`
}

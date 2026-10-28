import { organizationRoutes } from '@/lib/navigation/paths'
import { resourceParam } from '@/app/workspace/[workspaceId]/home/search-params'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

/** Preserve the selected resource when a new conversation receives its chat URL. */
export function chatUrl(
  owner: string | { organizationId: string },
  chatId: string,
  mode?: ChatRequestMode
): string {
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  const resource = current.get(resourceParam.key)
  if (resource) carried.set(resourceParam.key, resource)
  const search = carried.toString()
  const routes = typeof owner === 'object' ? organizationRoutes(owner.organizationId) : null
  const path = routes
    ? mode === 'assistant'
      ? routes.searchChat(chatId)
      : routes.chat(chatId)
    : `/workspace/${owner}/chat/${chatId}`
  return `${path}${search ? `?${search}` : ''}`
}

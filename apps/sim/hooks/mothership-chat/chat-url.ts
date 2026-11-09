import { resourceParam } from '@/lib/mothership/chat/search-params'
import type { ChatRequestMode } from '@/lib/mothership/chat/types'
import { organizationRoutes } from '@/lib/navigation/paths'

/** Preserve the selected resource when a new conversation receives its default chat URL. */
export function chatUrl(organizationId: string, chatId: string, mode?: ChatRequestMode): string {
  const routes = organizationRoutes(organizationId)
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  const resource = current.get(resourceParam.key)
  if (resource) carried.set(resourceParam.key, resource)
  const search = carried.toString()
  const path = mode === 'assistant' ? routes.searchChat(chatId) : routes.chat(chatId)
  return `${path}${search ? `?${search}` : ''}`
}

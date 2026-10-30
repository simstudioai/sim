import { organizationRoutes } from '@/lib/navigation/paths'
import { organizationSearchParsers } from '@/app/o/[organizationId]/search/search-params'
import {
  resourceParam,
  searchFilterParsers,
} from '@/app/workspace/[workspaceId]/home/search-params'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

/** Preserve resource and Search context when a new conversation receives its chat URL. */
export function chatUrl(
  owner: string | { organizationId: string },
  chatId: string,
  mode?: ChatRequestMode
): string {
  const routes = typeof owner === 'object' ? organizationRoutes(owner.organizationId) : null
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  const resource = current.get(resourceParam.key)
  if (resource) carried.set(resourceParam.key, resource)
  if (typeof owner === 'object' && mode === 'assistant') {
    for (const key of Object.keys({ ...organizationSearchParsers, ...searchFilterParsers })) {
      const value = current.get(key)
      if (value) carried.set(key, value)
    }
    if (
      organizationSearchParsers.mode.parse(current.get('mode') ?? '') === null &&
      window.location.pathname === routes?.search
    )
      carried.set('mode', 'search')
  }
  const search = carried.toString()
  const path = routes
    ? mode === 'assistant'
      ? routes.searchChat(chatId)
      : routes.chat(chatId)
    : `/workspace/${owner}/chat/${chatId}`
  return `${path}${search ? `?${search}` : ''}`
}

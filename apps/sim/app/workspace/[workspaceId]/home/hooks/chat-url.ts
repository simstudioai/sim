import { resourceParam } from '@/app/workspace/[workspaceId]/home/search-params'

/** Preserve the selected resource when a new conversation receives its chat URL. */
export function chatUrl(owner: string | { organizationId: string }, chatId: string): string {
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  const resource = current.get(resourceParam.key)
  if (resource) carried.set(resourceParam.key, resource)
  const search = carried.toString()
  const basePath = typeof owner === 'string' ? `/workspace/${owner}` : `/o/${owner.organizationId}`
  return `${basePath}/chat/${chatId}${search ? `?${search}` : ''}`
}

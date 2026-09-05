import {
  modeParam,
  resourceParam,
  searchFilterParsers,
  searchQueryParam,
} from '@/app/workspace/[workspaceId]/home/search-params'

/**
 * Preserve the view selected while a new chat was starting. The submitted turn
 * supplies a fallback only; it cannot overwrite a subsequent mode switch.
 */
export function chatUrl(
  workspaceId: string,
  chatId: string,
  requestMode?: 'agent' | 'assistant'
): string {
  const current = new URLSearchParams(window.location.search)
  const carried = new URLSearchParams()
  const mode =
    modeParam.parser.parse(current.get(modeParam.key) ?? '') ??
    (requestMode === 'assistant' ? 'assistant' : requestMode === 'agent' ? 'build' : null)
  if (mode) carried.set(modeParam.key, mode)
  const keys =
    mode === 'search'
      ? [resourceParam.key, searchQueryParam.key, ...Object.keys(searchFilterParsers)]
      : [resourceParam.key]
  for (const key of keys) {
    const value = current.get(key)
    if (value) carried.set(key, value)
  }
  const search = carried.toString()
  return `/workspace/${workspaceId}/chat/${chatId}${search ? `?${search}` : ''}`
}

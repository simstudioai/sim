import type { SearchHistoryResponse } from '@/lib/api/contracts/knowledge/search-history'
import { externalLinkHostname, linkSiteName } from '@/lib/mothership/chat/source-link'

/** One chip's sources, newest first, with what it reads as and where it came from. */
export interface RecentSourceGroup {
  source: SearchHistoryResponse['sources'][number]
  label: string
  host: string | null
  urls: string[]
}

/**
 * The server keeps sources newest first, one per URL. Chips that would read the same from the same
 * place, such as several messages in one channel, are one chip at its latest visit.
 */
export function groupRecentSources(history: SearchHistoryResponse): RecentSourceGroup[] {
  const groups = new Map<string, RecentSourceGroup>()
  for (const source of history.sources) {
    const label = source.title ?? linkSiteName(source.url, source.siteName)
    const host = externalLinkHostname(source.url)
    const key = `${source.connectorType ?? host}\0${label.toLowerCase()}`
    const existing = groups.get(key)
    if (existing) existing.urls.push(source.url)
    else groups.set(key, { source, label, host, urls: [source.url] })
  }
  return [...groups.values()]
}

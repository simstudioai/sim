import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/**
 * Sources keyed by URL across the given lists, in order, where the first source
 * seen for a URL wins. Every surface that lists or looks up a turn's sources
 * dedupes through this.
 */
export function indexSourcesByUrl(...lists: Iterable<SourceTagData>[]): Map<string, SourceTagData> {
  const byUrl = new Map<string, SourceTagData>()
  for (const list of lists) {
    for (const source of list) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source)
    }
  }
  return byUrl
}

import {
  parseSpecialTags,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/**
 * Every distinct `<source>` cited across the given prose, in first-cited order,
 * for the footer strip. Callers pass the text segments the message actually
 * renders as its answer.
 */
export function collectMessageSources(texts: readonly string[]): SourceTagData[] {
  const byUrl = new Map<string, SourceTagData>()
  for (const text of texts) {
    for (const segment of parseSpecialTags(text, false).segments) {
      if (segment.type === 'source' && !byUrl.has(segment.data.url)) {
        byUrl.set(segment.data.url, segment.data)
      }
    }
  }
  return [...byUrl.values()]
}

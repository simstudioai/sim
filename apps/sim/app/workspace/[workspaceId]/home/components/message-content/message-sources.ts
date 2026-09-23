import {
  parseSpecialTags,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { resolveMessageCitations } from '@/app/workspace/[workspaceId]/home/components/message-content/resolve-citations'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

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

/** Only main-answer citations populate the panel, never every fetched result or an agent's scratch work. */
export function collectCitedMessageSources(
  blocks: readonly ContentBlock[],
  fallbackContent: string,
  requireEvidence = true
): SourceTagData[] {
  const resolved = resolveMessageCitations(blocks, fallbackContent, requireEvidence)
  const texts = resolved.blocks
    .filter((block) => block.type === 'text' && !block.parentToolCallId && !block.subagent)
    .map((block) => block.content ?? '')
    .filter((text) => text.trim().length > 0)
  return collectMessageSources(texts.length ? texts : [resolved.fallbackContent])
}

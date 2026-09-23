import {
  collectRetrievalCitationEvidence,
  parseCitationRecord as parseRecord,
} from '@/lib/mothership/chat/citation-evidence'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

/** Source cards use metadata from successful retrieval, never model-authored IDs or URLs. */
export function resolveMessageCitations(
  blocks: readonly ContentBlock[],
  fallbackContent: string,
  requireEvidence = false
) {
  const evidence = collectRetrievalCitationEvidence(blocks)
  function resolve(text: string) {
    return text.replace(/<source>\s*([\s\S]*?)\s*<\/source>/g, (tag, json: string) => {
      const source = parseRecord(json)
      if (!source || !Object.hasOwn(source, 'id')) return requireEvidence ? '' : tag
      const id = source.id
      const canonicalId =
        typeof id === 'string' && /^document:live:[A-Za-z0-9_-]+={1,2}$/.test(id)
          ? id.replace(/=+$/, '')
          : id
      const resolved = typeof canonicalId === 'string' ? evidence.get(canonicalId) : undefined
      return resolved
        ? `<source>${JSON.stringify(resolved).replaceAll('<', '\\u003c')}</source>`
        : ''
    })
  }
  const textRuns: ContentBlock[] = []
  for (const block of blocks) {
    const previous = textRuns.at(-1)
    if (
      previous &&
      block.content &&
      previous.content &&
      (block.type === 'text' || block.type === 'subagent_text') &&
      previous.type === block.type &&
      previous.spanId === block.spanId &&
      previous.parentSpanId === block.parentSpanId &&
      previous.parentToolCallId === block.parentToolCallId &&
      previous.subagent === block.subagent
    ) {
      textRuns[textRuns.length - 1] = { ...previous, content: previous.content + block.content }
    } else textRuns.push(block)
  }
  return {
    blocks: textRuns.map((block) =>
      block.content ? { ...block, content: resolve(block.content) } : block
    ),
    fallbackContent: resolve(fallbackContent),
  }
}

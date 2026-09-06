import { isRecordLike } from '@sim/utils/object'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return isRecordLike(value) ? value : null
}

/** Source cards use metadata from successful retrieval, never model-authored IDs or URLs. */
export function resolveMessageCitations(
  blocks: readonly ContentBlock[],
  fallbackContent: string,
  requireEvidence = false
) {
  const evidence = new Map<string, Record<string, unknown>>()
  for (const block of blocks) {
    const call = block.toolCall
    if (
      !call ||
      !['search_workspace', 'read_document'].includes(call.name) ||
      call.status !== 'success' ||
      !call.result?.success
    )
      continue
    const output = parseRecord(call.result.output)
    if (!output || output.success === false) continue
    const data = parseRecord(output.data) ?? output
    const results = Array.isArray(data.results) ? data.results : [data]
    for (const raw of results) {
      const result = parseRecord(raw)
      if (
        !result ||
        typeof result.citationId !== 'string' ||
        typeof result.citationUrl !== 'string'
      )
        continue
      try {
        const url = new URL(result.citationUrl)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      } catch {
        continue
      }
      if (evidence.has(result.citationId)) continue
      evidence.set(result.citationId, {
        url: result.citationUrl,
        ...(typeof result.documentName === 'string' ? { title: result.documentName } : {}),
        ...(typeof result.knowledgeBaseName === 'string'
          ? { siteName: result.knowledgeBaseName }
          : {}),
        ...(typeof result.connectorType === 'string'
          ? { connectorType: result.connectorType }
          : {}),
        ...(typeof result.author === 'string' ? { author: result.author } : {}),
        ...(typeof result.sourceModifiedAt === 'string'
          ? { updatedAt: result.sourceModifiedAt }
          : {}),
        ...(typeof result.content === 'string' ? { snippet: result.content.slice(0, 500) } : {}),
      })
    }
  }
  function resolve(text: string) {
    return text.replace(/<source>\s*([\s\S]*?)\s*<\/source>/g, (tag, json: string) => {
      const source = parseRecord(json)
      if (!source || !Object.hasOwn(source, 'id')) return requireEvidence ? '' : tag
      const resolved = typeof source.id === 'string' ? evidence.get(source.id) : undefined
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

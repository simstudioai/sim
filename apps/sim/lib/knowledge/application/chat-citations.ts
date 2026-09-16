import { isPlainRecord } from '@sim/utils/object'
import { compactRetrievalCitations } from '@/lib/copilot/chat/retrieval-citations'
import type { ToolCallSummary } from '@/lib/copilot/request/types'

export interface SearchChatCitation {
  id: string
  title: string
  url: string
}

/** Resolves Assistant source tags only against successful, bounded retrieval evidence. */
export function resolveSearchChatCitations(content: string, toolCalls: ToolCallSummary[]) {
  const evidence = new Map<string, SearchChatCitation>()
  for (const tool of toolCalls) {
    if (tool.status !== 'success') continue
    const compact = compactRetrievalCitations(tool.name, tool.result)
    if (!isPlainRecord(compact) || !isPlainRecord(compact.data)) continue
    const results = compact.data.results
    if (!Array.isArray(results)) continue
    for (const result of results) {
      if (
        evidence.size >= 50 ||
        !isPlainRecord(result) ||
        typeof result.citationId !== 'string' ||
        typeof result.citationUrl !== 'string' ||
        evidence.has(result.citationId) ||
        !URL.canParse(result.citationUrl)
      )
        continue
      const url = new URL(result.citationUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue
      evidence.set(result.citationId, {
        id: result.citationId,
        title: typeof result.documentName === 'string' ? result.documentName : 'Source',
        url: url.href,
      })
    }
  }

  const citations: SearchChatCitation[] = []
  const resolved = content.replace(/<source>\s*([\s\S]*?)\s*<\/source>/g, (_tag, json: string) => {
    let source: unknown
    try {
      source = JSON.parse(json)
    } catch {
      return ''
    }
    if (!isPlainRecord(source) || typeof source.id !== 'string') return ''
    const citation = evidence.get(source.id)
    if (!citation) return ''
    let index = citations.findIndex((item) => item.id === citation.id)
    if (index === -1) {
      index = citations.length
      citations.push(citation)
    }
    return `[${index + 1}](<${citation.url.replaceAll('>', '%3E')}>)`
  })
  return { content: resolved, citations }
}

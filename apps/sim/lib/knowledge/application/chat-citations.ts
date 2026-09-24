import { isPlainRecord } from '@sim/utils/object'
import { compactRetrievalCitations } from '@/lib/mothership/chat/retrieval-citations'
import type { ToolCallSummary } from '@/lib/mothership/request/types'

export interface SearchChatCitation {
  id: string
  title: string
  url: string
}

/** Cards the Chat UI renders from a JSON payload; an MCP text answer drops them. */
const CARD_TAGS = 'options|question|usage_upgrade|credential|workspace_resource'
/** A JSON string owns its escaped quotes and any tag-shaped text inside it. */
const JSON_STRING = '"(?:\\\\.|[^"\\\\\\r\\n])*"'
/**
 * A card whose body is a JSON value, a thinking block, or a card opener left unclosed before a
 * JSON payload. A tag-shaped pair or opener in ordinary prose is not a card and stays.
 */
const INTERACTIVE_CARD = new RegExp(
  [
    `<(${CARD_TAGS})>\\s*[[{](?:${JSON_STRING}|[^"<])*?[\\]}]\\s*</\\1>`,
    '<thinking>[\\s\\S]*?</thinking>',
    `<(?:${CARD_TAGS})>\\s*[[{][\\s\\S]*$`,
  ].join('|'),
  'g'
)

/** Removes interactive Chat cards so a text-only surface receives only the answer prose. */
export function stripInteractiveCards(content: string): string {
  return content.replace(INTERACTIVE_CARD, '')
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

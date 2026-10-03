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
/** A closed card candidate; its body is removed only when it parses as a JSON payload. */
const CLOSED_CARD = new RegExp(
  `<(${CARD_TAGS})>(\\s*[[{](?:${JSON_STRING}|[^"<])*?[\\]}]\\s*)</\\1>`,
  'g'
)
/** A card the model left open, followed by the start of a JSON object with a quoted key. */
const UNCLOSED_CARD = new RegExp(
  `<(${CARD_TAGS})>(?![\\s\\S]*</\\1>)\\s*(?:\\{\\s*"|\\[\\s*[{"])[\\s\\S]*$`
)
const THINKING = /<thinking>[\s\S]*?<\/thinking>/g

function isJsonPayload(body: string): boolean {
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

/**
 * Removes interactive Chat cards so a text-only surface receives only the answer prose. A tag
 * pair whose body is not a JSON payload is prose that happens to look like a card, and stays.
 */
export function stripInteractiveCards(content: string): string {
  return content
    .replace(CLOSED_CARD, (card, _tag: string, body: string) => (isJsonPayload(body) ? '' : card))
    .replace(THINKING, '')
    .replace(UNCLOSED_CARD, '')
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

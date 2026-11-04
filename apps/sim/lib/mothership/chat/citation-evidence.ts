import { toRecordOrNull } from '@sim/utils/object'

export interface RetrievalCitationBlock {
  toolCall?: { name: string; status: string; result?: { success: boolean; output?: unknown } }
}

type RetrievalCitationSource = {
  url: string
  title?: string
  siteName?: string
  connectorType?: string
  author?: string
  updatedAt?: string
  snippet?: string
}

const WEB_TOOLS = new Set(['web_search', 'web_fetch'])
/** Tools whose successful results supply sources: connected-source retrieval and public web research. */
const CITATION_TOOLS = new Set(['search_workspace', 'read_document', ...WEB_TOOLS])

/** Whether a successful result of this tool may supply source destinations. */
export function isCitationTool(toolName: string): boolean {
  return CITATION_TOOLS.has(toolName)
}

/** Web research only cites in Search Assistant; elsewhere its results carry no citation handles. */
export function isWebResearchTool(toolName: string): boolean {
  return WEB_TOOLS.has(toolName)
}

/**
 * A result in retrieval's citation fields. A web page names its address `url` and its heading
 * `title`, and leaves its site name and summary to the link preview; a compacted page already
 * carries the citation fields.
 */
export function toCitationResult(
  toolName: string,
  result: Record<string, unknown>
): Record<string, unknown> {
  if (!isWebResearchTool(toolName) || typeof result.citationUrl === 'string') return result
  return {
    citationId: result.citationId,
    citationUrl: result.url,
    ...(typeof result.title === 'string' && result.title.trim()
      ? { documentName: result.title }
      : {}),
  }
}

export function parseCitationRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseCitationRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return toRecordOrNull(value)
}

/** Only successful retrieval and web research results may supply source destinations. */
export function collectRetrievalCitationEvidence(blocks: readonly RetrievalCitationBlock[]) {
  const evidence = new Map<string, RetrievalCitationSource>()
  for (const block of blocks) {
    const call = block.toolCall
    if (!call || !isCitationTool(call.name) || call.status !== 'success' || !call.result?.success)
      continue
    const output = parseCitationRecord(call.result.output)
    if (!output || output.success === false) continue
    const data = parseCitationRecord(output.data) ?? output
    const results = Array.isArray(data.results) ? data.results : [data]
    for (const raw of results) {
      const record = parseCitationRecord(raw)
      const result = record && toCitationResult(call.name, record)
      if (
        !result ||
        typeof result.citationId !== 'string' ||
        typeof result.citationUrl !== 'string'
      )
        continue
      try {
        const url = new URL(result.citationUrl)
        // A web page can steer a fetched URL, so `https://trusted.example@other.example` never cites.
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
        if (url.username || url.password) continue
      } catch {
        continue
      }
      if (evidence.has(result.citationId)) continue
      const siteName =
        typeof result.siteName === 'string' ? result.siteName : result.knowledgeBaseName
      const updatedAt = result.sourceDate ?? result.sourceModifiedAt
      evidence.set(result.citationId, {
        url: result.citationUrl,
        ...(typeof result.documentName === 'string' ? { title: result.documentName } : {}),
        ...(typeof siteName === 'string' ? { siteName } : {}),
        ...(typeof result.connectorType === 'string'
          ? { connectorType: result.connectorType }
          : {}),
        ...(typeof result.author === 'string' ? { author: result.author } : {}),
        ...(typeof updatedAt === 'string' ? { updatedAt } : {}),
        ...(typeof result.content === 'string' ? { snippet: result.content.slice(0, 500) } : {}),
      })
    }
  }
  return evidence
}

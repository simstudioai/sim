import { isRecordLike } from '@sim/utils/object'
import {
  isCitationTool,
  isWebResearchTool,
  toCitationResult,
} from '@/lib/mothership/chat/citation-evidence'

/**
 * Keeps only bounded display evidence when large retrieval results leave the live stream,
 * plus a partial-coverage marker so an empty timed-out search never reads as "No results".
 */
export function compactRetrievalCitations(toolName: string, raw: unknown): unknown {
  if (!isCitationTool(toolName)) return undefined
  let output: unknown = raw
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output)
    } catch {
      return undefined
    }
  }
  if (!isRecordLike(output) || output.success === false) return undefined
  const data = isRecordLike(output.data) ? output.data : output
  const results = Array.isArray(data.results) ? data.results : [data]
  // A live document reference permits 4,000 characters, plus the document: citation prefix.
  const citations = results.slice(0, 50).flatMap((raw) => {
    const item = isRecordLike(raw) ? toCitationResult(toolName, raw) : raw
    if (
      !isRecordLike(item) ||
      typeof item.citationId !== 'string' ||
      item.citationId.length > 4009 ||
      typeof item.citationUrl !== 'string' ||
      item.citationUrl.length > 2048
    )
      return []
    const citation: Record<string, string> = {
      citationId: item.citationId,
      citationUrl: item.citationUrl,
    }
    for (const key of [
      'documentName',
      'knowledgeBaseName',
      'siteName',
      'connectorType',
      'author',
      'sourceModifiedAt',
      'sourceDate',
      'content',
    ]) {
      const value = item[key]
      if (typeof value === 'string') citation[key] = value.slice(0, 500)
    }
    return [citation]
  })
  if (citations.length === 0 && isWebResearchTool(toolName)) return undefined
  const partial = isRecordLike(data.retrieval) && data.retrieval.status === 'partial'
  return {
    success: true,
    data: { results: citations, ...(partial ? { retrieval: { status: 'partial' } } : {}) },
  }
}

import { isRecordLike } from '@sim/utils/object'

/** Keeps only bounded display evidence when large retrieval results leave the live stream. */
export function compactRetrievalCitations(toolName: string, raw: unknown): unknown {
  if (!['search_workspace', 'read_document'].includes(toolName)) return undefined
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
  const citations = results.slice(0, 50).flatMap((item) => {
    if (
      !isRecordLike(item) ||
      typeof item.citationId !== 'string' ||
      item.citationId.length > 240 ||
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
      'connectorType',
      'author',
      'sourceModifiedAt',
      'content',
    ]) {
      const value = item[key]
      if (typeof value === 'string') citation[key] = value.slice(0, 500)
    }
    return [citation]
  })
  return { success: true, data: { results: citations } }
}

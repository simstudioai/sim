import { isRecordLike } from '@sim/utils/object'

export interface RetrievalCitationBlock {
  toolCall?: { name: string; status: string; result?: { success: boolean; output?: unknown } }
}

export function parseCitationRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseCitationRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return isRecordLike(value) ? value : null
}

/** Only successful retrieval tool results may supply source destinations. */
export function collectRetrievalCitationEvidence(blocks: readonly RetrievalCitationBlock[]) {
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
    const output = parseCitationRecord(call.result.output)
    if (!output || output.success === false) continue
    const data = parseCitationRecord(output.data) ?? output
    const results = Array.isArray(data.results) ? data.results : [data]
    for (const raw of results) {
      const result = parseCitationRecord(raw)
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
      const siteName =
        typeof result.siteName === 'string' ? result.siteName : result.knowledgeBaseName
      evidence.set(result.citationId, {
        url: result.citationUrl,
        ...(typeof result.documentName === 'string' ? { title: result.documentName } : {}),
        ...(typeof siteName === 'string' ? { siteName } : {}),
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
  return evidence
}

import type { BenchmarkArtifacts } from '@/lib/benchmarks/types'
import { parseCitationRecord } from '@/lib/mothership/chat/citation-evidence'
import type { ToolCallSummary } from '@/lib/mothership/request/types'

type Reconstruction = NonNullable<BenchmarkArtifacts['reconstruction']>

/** Quotes may come from a source's text, chunks, or returned identity metadata. */
function containsQuote(value: unknown, quote: string): boolean {
  if (typeof value === 'string') return value.includes(quote)
  if (Array.isArray(value)) return value.some((item) => containsQuote(item, quote))
  const record = parseCitationRecord(value)
  return record !== null && Object.values(record).some((item) => containsQuote(item, quote))
}

/** Preserve only evidence actually retrieved for the answer's exact anchor in the submitted spec. */
export function verifyRecoveryEvidence(
  spec: string,
  answers: Reconstruction,
  toolCalls: ToolCallSummary[]
): Reconstruction {
  const evidence = toolCalls.flatMap((call) => {
    if (call.status !== 'success' || !['search_workspace', 'read_document'].includes(call.name))
      return []
    const support = call.params?.specPassage
    if (typeof support !== 'string' || !support.trim() || !spec.includes(support)) return []
    const output = parseCitationRecord(call.result)
    if (!output || output.success === false) return []
    const data = parseCitationRecord(output.data) ?? output
    const results = Array.isArray(data.results) ? data.results : [data]
    return results.flatMap((raw) => {
      const source = parseCitationRecord(raw)
      return source && typeof source.citationId === 'string' ? [{ support, source }] : []
    })
  })
  return answers.map((answer) => {
    const unverified: string[] = []
    const sources = (answer.sources ?? []).flatMap(({ citationId, quote }) => {
      const match = evidence.find(
        ({ support, source }) =>
          support === answer.support &&
          source.citationId === citationId &&
          quote.trim() &&
          containsQuote(source, quote)
      )
      if (!match) {
        unverified.push(citationId)
        return []
      }
      const { source } = match
      const rawUrl = source.citationUrl ?? source.sourceUrl
      const parsedUrl = typeof rawUrl === 'string' ? URL.parse(rawUrl) : null
      const url =
        parsedUrl && ['https:', 'http:'].includes(parsedUrl.protocol) ? parsedUrl.href : undefined
      return [
        {
          citationId,
          quote,
          ...(url ? { url } : {}),
          ...(typeof source.documentName === 'string' ? { title: source.documentName } : {}),
        },
      ]
    })
    return {
      ...answer,
      sources,
      evidenceError: unverified.length
        ? `Could not verify source quotes for ${unverified.join(', ')} against the retrieved evidence for this spec passage. Review the answer before giving credit.`
        : undefined,
    }
  })
}

import { createLogger } from '@sim/logger'
import { compareStrings, truncateAtCodePoint } from '@sim/utils/string'
import { generateSearchEmbedding } from '@/lib/embeddings'
import { getSearchIndex, getSearchPage } from '@/lib/search/precomputed'
import type { SearchPage, SearchResult } from '@/lib/search/types'
import { normalizeSearchText } from '@/lib/search/utils'
import { DOCS_BASE_URL } from '@/lib/urls'

const logger = createLogger('DocsSearch')
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'how',
  'i',
  'in',
  'is',
  'of',
  'the',
  'to',
])
const HYBRID_TIMEOUT_MS = 1000
let hybridRequests = 0

function resultFor(page: SearchPage, id: string, url: string, heading: string): SearchResult {
  return {
    id,
    type: 'page',
    url,
    content: heading || page.title,
    breadcrumbs: [...page.breadcrumbs],
  }
}

function lexicalSearch(query: string, limit: number): SearchResult[] {
  const phrase = normalizeSearchText(query)
  const tokens = query
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean)
  const significant = tokens.filter(
    (token) =>
      !STOP_WORDS.has(token.toLowerCase()) || (token.length === 2 && token === token.toUpperCase())
  )
  const terms = [
    ...new Set((significant.length ? significant : tokens).map((token) => token.toLowerCase())),
  ]
  if (!terms.length) return []
  const scores = new Map<string, { score: number; result: SearchResult }>()
  for (const { chunk, body, heading, title } of getSearchIndex()) {
    let score = 0
    let matched = 0
    for (const term of terms) {
      const titleMatch = title.includes(term)
      const headingMatch = heading.includes(term)
      const bodyMatch = body.includes(term)
      if (titleMatch || headingMatch || bodyMatch) matched += 1
      score += (titleMatch ? 18 : 0) + (headingMatch ? 12 : 0) + (bodyMatch ? 2 : 0)
    }
    if (matched < Math.ceil(terms.length * 0.7)) continue
    score += (title === phrase ? 150 : 0) + (heading === phrase ? 80 : 0)
    score += body.includes(phrase) ? 12 : 0
    const existing = scores.get(chunk.pageId)
    if (existing && existing.score >= score) continue
    const page = getSearchPage(new URL(chunk.sourceLink).pathname)
    if (!page) continue
    scores.set(chunk.pageId, {
      score,
      result: resultFor(page, chunk.id, chunk.sourceLink, chunk.headerText),
    })
  }
  return [...scores.values()]
    .sort(
      (left, right) => right.score - left.score || compareStrings(left.result.url, right.result.url)
    )
    .slice(0, limit)
    .map(({ result }) => result)
}

interface DatabaseResult {
  chunk_id: string
  source_document: string
  source_link: string
  header_text: string
  metadata: { contentHash?: string }
}

function hybridResults(lists: DatabaseResult[][], limit: number): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>()
  for (const list of lists) {
    const seenPages = new Set<string>()
    list.forEach((row, index) => {
      let citation: URL
      try {
        citation = new URL(row.source_link)
      } catch {
        return
      }
      if (citation.origin !== new URL(DOCS_BASE_URL).origin) return
      const page = getSearchPage(citation.pathname)
      if (!page || row.metadata?.contentHash !== page.contentHash) return
      if (citation.hash && !page.headings.includes(citation.hash.slice(1))) return
      if (seenPages.has(page.id)) return
      seenPages.add(page.id)
      const existing = scores.get(page.id)
      const score = (existing?.score ?? 0) + 1 / (60 + index + 1)
      scores.set(page.id, {
        score,
        result: existing?.result ?? resultFor(page, row.chunk_id, citation.href, row.header_text),
      })
    })
  }
  return [...scores.values()]
    .sort(
      (left, right) => right.score - left.score || compareStrings(left.result.url, right.result.url)
    )
    .slice(0, limit)
    .map(({ result }) => result)
}

async function hybridSearch(
  query: string,
  limit: number,
  signal: AbortSignal,
  onResults: (results: SearchResult[]) => void
) {
  const { searchDatabase } = await import('@/lib/search/database')
  if (signal.aborted) return []
  const sql = searchDatabase()
  const keyword = sql<DatabaseResult[]>`
    SELECT chunk_id, source_document, source_link, header_text, metadata
    FROM docs_embeddings
    WHERE chunk_text_tsv @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank(chunk_text_tsv, plainto_tsquery('english', ${query})) DESC, source_link
    LIMIT ${limit * 3}
  `
  let vector: typeof keyword | undefined
  const sources: DatabaseResult[][] = [[], []]
  async function collect(source: number, request: PromiseLike<DatabaseResult[]>) {
    const rows = await request
    if (signal.aborted) return
    sources[source] = rows
    onResults(hybridResults(sources, limit))
  }
  async function collectVector() {
    const embedding = await generateSearchEmbedding(query, signal).catch(() => null)
    if (!embedding || signal.aborted) return
    vector = sql<DatabaseResult[]>`
        SELECT chunk_id, source_document, source_link, header_text, metadata
        FROM docs_embeddings
        WHERE 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) >= 0.6
        ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector, source_link
        LIMIT ${limit * 3}
      `
    await collect(1, vector)
  }
  const cancel = () => {
    keyword.cancel()
    vector?.cancel()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const lists = await Promise.allSettled([collect(0, keyword), collectVector()])
    for (const [source, list] of lists.entries()) {
      if (list.status === 'rejected') {
        if (!signal.aborted)
          logger.warn('Hybrid search query unavailable; serving remaining results', {
            source: source === 0 ? 'keyword' : 'vector',
            error: list.reason,
          })
      }
    }
    return hybridResults(sources, limit)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/** Shared UI/MCP search always has a local, deterministic catalog-backed result path. */
export async function searchDocs(
  input: string,
  requestedLimit = 10,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const query = truncateAtCodePoint(input.trim(), 256, '')
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(20, Math.trunc(requestedLimit)))
    : 10
  if (!query) return []
  const lexical = lexicalSearch(query, limit)
  if (lexical.length || !process.env.DATABASE_URL || hybridRequests >= 2 || signal?.aborted)
    return lexical
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let partial: SearchResult[] = []
  let onAbort: (() => void) | undefined
  const aborted = new Promise<SearchResult[]>((resolve) => {
    onAbort = () => resolve(partial)
    combined.addEventListener('abort', onAbort, { once: true })
    if (combined.aborted) onAbort()
  })
  const timeout = setTimeout(() => controller.abort(), HYBRID_TIMEOUT_MS)
  hybridRequests += 1
  const pending = hybridSearch(query, limit, combined, (results) => {
    partial = results
  })
    .catch((error) => {
      if (!combined.aborted)
        logger.warn('Hybrid search unavailable; serving local results', { error })
      return partial
    })
    .finally(() => {
      hybridRequests -= 1
    })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    clearTimeout(timeout)
    if (onAbort) combined.removeEventListener('abort', onAbort)
  }
}

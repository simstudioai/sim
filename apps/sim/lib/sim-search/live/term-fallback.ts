import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { dateSortDirection } from '@/lib/sim-search/live/dates'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { joinMessages } from '@/lib/sim-search/live/pages'
import { significantTerms, termCoverage } from '@/lib/sim-search/live/text-match'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

/**
 * Candidates the any-term search requests. Providers rank OR queries loosely, so the page is
 * chosen from a wider pool by how many terms each candidate contains.
 */
const ANY_TERM_CANDIDATES = 25

/** Partial matches added to a page, so a loosely matching provider cannot crowd out other sources. */
const ANY_TERM_RESULTS = 5

/**
 * Time the any-term search may take before the all-terms page is returned without it, so a slow
 * OR query cannot cost the account the matches it already has.
 */
const ANY_TERM_BUDGET_MS = 4000

const logger = createLogger('SimSearchTermFallback')

/** One provider item, however many queries returned it. */
const documentKey = ({ container, kind, id }: NativeDocument) =>
  JSON.stringify([container ?? '', kind ?? '', id])

/**
 * Searches with every query word required, then, when that exhausts the provider's matches
 * without filling the page, with any of the query's significant terms. A natural-language query
 * often contains one word the right page lacks, which an all-terms search turns into no result.
 *
 * All-terms matches keep their provider order ahead of the rest. At most a few matches are added,
 * ordered by how many terms their title and preview contain, then how many their title contains,
 * then provider order. The fallback runs only for a plain relevance-ordered query: native queries are
 * the caller's exact syntax, and a date-sorted page is reordered by date. It never replaces a
 * continuable page, so a cursor always continues the query that produced it.
 *
 * The any-term search gets its own budget, passed to the provider as the request's signal, so a
 * slow OR query is cancelled rather than awaited. Whenever it fails short of the caller's own
 * cancellation (a provider refusal, the budget running out, a transport error), the all-terms page
 * is kept, reported as partial. Cancellation through `signal` propagates like the first search.
 */
export async function searchWithAnyTermFallback(
  search: (input: NativeSearchInput) => Promise<NativePage>,
  input: NativeSearchInput,
  signal: AbortSignal
): Promise<NativePage> {
  const strict = await search(input)
  const terms = significantTerms(input.query)
  if (
    input.native ||
    dateSortDirection(input.filters) ||
    terms.length < 2 ||
    strict.nextCursor ||
    strict.hasMore ||
    strict.documents.length >= input.limit
  )
    return strict
  const budget = new AbortController()
  const timer = setTimeout(
    () => budget.abort(new DOMException('Any-term search budget exhausted', 'TimeoutError')),
    ANY_TERM_BUDGET_MS
  )
  let relaxed: NativePage
  try {
    relaxed = await search({
      ...input,
      limit: Math.max(input.limit, ANY_TERM_CANDIDATES),
      textMatch: 'any',
      signal: AbortSignal.any([signal, budget.signal]),
    })
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof NativeSearchError)
      return { ...strict, partial: true, message: joinMessages([strict.message, error.message]) }
    logger.warn('Any-term search failed; keeping the all-terms page', {
      timedOut: budget.signal.aborted,
      error: getErrorMessage(error),
    })
    return {
      ...strict,
      partial: true,
      message: joinMessages([
        strict.message,
        'Results containing only some of the search terms could not be retrieved, so only results containing every term are shown.',
      ]),
    }
  } finally {
    clearTimeout(timer)
  }
  const seen = new Set(strict.documents.map(documentKey))
  const additions = relaxed.documents
    .filter((document) => !seen.has(documentKey(document)))
    .map((document, rank) => ({
      document,
      rank,
      coverage: termCoverage(`${document.title}\n${document.content}`, terms),
      titleCoverage: termCoverage(document.title, terms),
    }))
    .sort(
      (left, right) =>
        right.coverage - left.coverage ||
        right.titleCoverage - left.titleCoverage ||
        left.rank - right.rank
    )
    .slice(0, Math.min(ANY_TERM_RESULTS, input.limit - strict.documents.length))
    .map(({ document }) => document)
  if (!additions.length) return strict
  return {
    ...strict,
    documents: [...strict.documents, ...additions],
    partial: strict.partial || relaxed.partial,
    message: joinMessages([
      strict.message,
      'Few results contained every search term, so results containing some of the terms follow, ordered by how many they contain.',
    ]),
  }
}

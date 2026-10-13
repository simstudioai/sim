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

/** One provider item, however many queries returned it. */
const documentKey = ({ container, kind, id }: NativeDocument) =>
  JSON.stringify([container ?? '', kind ?? '', id])

/**
 * Searches with every query word required, then, when that exhausts the provider's matches
 * without filling the page, with any of the query's significant terms. A natural-language query
 * often contains one word the right page lacks, which an all-terms search turns into no result.
 *
 * All-terms matches keep their provider order ahead of the rest; the added matches are ordered by
 * how many terms their title and preview contain, then how many their title contains, then
 * provider order. The fallback runs only for a plain relevance-ordered query: native queries are
 * the caller's exact syntax, and a date-sorted page is reordered by date. It never replaces a
 * continuable page, so a cursor always continues the query that produced it. A provider refusal
 * keeps the all-terms page, reported as partial with the provider's message; cancellation and
 * transport failures propagate like the first search.
 */
export async function searchWithAnyTermFallback(
  search: (input: NativeSearchInput) => Promise<NativePage>,
  input: NativeSearchInput
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
  const relaxed = await search({
    ...input,
    limit: Math.max(input.limit, ANY_TERM_CANDIDATES),
    textMatch: 'any',
  }).catch((error: unknown) => {
    if (error instanceof NativeSearchError) return error
    throw error
  })
  if (relaxed instanceof NativeSearchError)
    return { ...strict, partial: true, message: joinMessages([strict.message, relaxed.message]) }
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
    .slice(0, input.limit - strict.documents.length)
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

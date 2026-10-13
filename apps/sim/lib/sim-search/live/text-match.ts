import { findTermMatches, queryTerms } from '@/lib/knowledge/search/snippet'

/**
 * How a plain query's words must match a document. Confluence, Jira and Drive full-text search
 * require every word by default, so one word a page lacks hides it; `any` also matches pages that
 * contain only some of the query's words.
 */
export type TextMatch = 'all' | 'any'

/** Terms an any-term query sends; more would make the provider query long without adding recall. */
const MAX_ANY_TERMS = 8

/** Words that match nearly every page, so they would make an any-term query return noise. */
const STOPWORDS = new Set([
  'about',
  'all',
  'and',
  'any',
  'are',
  'can',
  'could',
  'did',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'into',
  'its',
  'not',
  'our',
  'should',
  'that',
  'the',
  'their',
  'there',
  'this',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
])

/**
 * The query's distinctive terms, longest first, each counted once whatever its case. Fewer than
 * two means an any-term query would match the same pages as the all-terms one.
 */
export function significantTerms(query: string): string[] {
  const seen = new Set<string>()
  return queryTerms(query)
    .filter((term) => {
      const key = term.toLowerCase()
      if (STOPWORDS.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ANY_TERMS)
}

/**
 * An any-term clause: every pair of terms ORed together, so a match contains at least two of them
 * somewhere in its full text, or either term of a two-term query.
 */
function anyTermClause(
  terms: readonly string[],
  clause: (term: string) => string,
  and: string,
  or: string
): string {
  const groups =
    terms.length === 2
      ? terms.map(clause)
      : terms.flatMap((first, index) =>
          terms.slice(index + 1).map((second) => `(${clause(first)} ${and} ${clause(second)})`)
        )
  return `(${groups.join(` ${or} `)})`
}

/** Escapes a value for a quoted JQL or CQL string, treating Lucene operators as literal text. */
const escapeSearchPhrase = (value: string) =>
  JSON.stringify(value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))

/** The `text ~` clause for a plain query in Jira JQL. */
export function jiraTextClause(text: string, match: TextMatch = 'all'): string {
  const terms = match === 'any' ? significantTerms(text) : []
  if (terms.length < 2) return `text ~ ${escapeSearchPhrase(text)}`
  return anyTermClause(terms, (term) => `text ~ ${escapeSearchPhrase(term)}`, 'AND', 'OR')
}

/**
 * The text clause for a plain query in Confluence CQL. `any` uses `siteSearch`, Confluence's own
 * relevance search, which ranks a page with the query's rarer words above the many pages sharing
 * one common word, where a `text ~` OR query ranks them the other way round.
 */
export function confluenceTextClause(text: string, match: TextMatch = 'all'): string {
  return `${match === 'any' ? 'siteSearch' : 'text'} ~ ${escapeSearchPhrase(text)}`
}

export const escapeDriveLiteral = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** The `fullText contains` clause for a plain query in Drive's q language. */
export function driveTextClause(text: string, match: TextMatch = 'all'): string {
  const terms = match === 'any' ? significantTerms(text) : []
  if (terms.length < 2) return `fullText contains '${escapeDriveLiteral(text)}'`
  return anyTermClause(
    terms,
    (term) => `fullText contains '${escapeDriveLiteral(term)}'`,
    'and',
    'or'
  )
}

/** How many distinct terms occur as whole words in the text. */
export function termCoverage(text: string, terms: readonly string[]): number {
  return terms.filter((term) => findTermMatches(text, [term]).length > 0).length
}

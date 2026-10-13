import { findTermMatches, queryTerms } from '@/lib/knowledge/search/snippet'

/**
 * How a plain query's words must match a document. Confluence, Jira and Drive full-text search
 * require every word by default, so one word a page lacks hides it; `any` matches pages containing
 * at least one of the query's significant terms.
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
 * The query's distinctive terms, longest first. Fewer than two means an any-term query would
 * match the same pages as the all-terms one.
 */
export function significantTerms(query: string): string[] {
  return queryTerms(query)
    .filter((term) => !STOPWORDS.has(term.toLowerCase()))
    .slice(0, MAX_ANY_TERMS)
}

/** Escapes a value for a quoted JQL or CQL string, treating Lucene operators as literal text. */
const escapeSearchPhrase = (value: string) =>
  JSON.stringify(value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))

/** The `text ~` clause for a plain query in Jira JQL or Confluence CQL. */
export function atlassianTextClause(text: string, match: TextMatch = 'all'): string {
  const terms = match === 'any' ? significantTerms(text) : []
  if (terms.length < 2) return `text ~ ${escapeSearchPhrase(text)}`
  return `(${terms.map((term) => `text ~ ${escapeSearchPhrase(term)}`).join(' OR ')})`
}

export const escapeDriveLiteral = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** The `fullText contains` clause for a plain query in Drive's q language. */
export function driveTextClause(text: string, match: TextMatch = 'all'): string {
  const terms = match === 'any' ? significantTerms(text) : []
  if (terms.length < 2) return `fullText contains '${escapeDriveLiteral(text)}'`
  return `(${terms.map((term) => `fullText contains '${escapeDriveLiteral(term)}'`).join(' or ')})`
}

/** How many distinct terms occur as whole words in the text. */
export function termCoverage(text: string, terms: readonly string[]): number {
  return terms.filter((term) => findTermMatches(text, [term]).length > 0).length
}

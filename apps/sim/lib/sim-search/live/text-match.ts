import { findTermMatches, queryTerms, textWords } from '@/lib/knowledge/search/snippet'

/**
 * How a plain query's words must match a document. Confluence and Jira text search require every
 * word by default, so one word a page lacks hides it; `any` also matches pages that contain only
 * some of the query's words.
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
  return distinctTerms(query, (term) => term.toLowerCase())
}

function distinctTerms(query: string, keyOf: (term: string) => string): string[] {
  const seen = new Set<string>()
  return queryTerms(query)
    .filter((term) => {
      const key = keyOf(term)
      if (STOPWORDS.has(term.toLowerCase()) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ANY_TERMS)
}

/**
 * One key for a word and its regular plural (`token`/`tokens`, `process`/`processes`). As in the
 * Porter stemmer, a final `-y` and `-ie(s)` fold to `i`, so `policy`/`policies` and
 * `movie`/`movies` each share a key.
 */
function singularKey(term: string): string {
  const key = term.toLowerCase()
  const stripped = /[^su]s$/.test(key) ? key.slice(0, -1) : key
  const stem = /(?:s|x|z|ch|sh|i)e$/.test(stripped) ? stripped.slice(0, -1) : stripped
  return stem.replace(/y$/, 'i')
}

/** Escapes a value for a quoted JQL or CQL string, treating Lucene operators as literal text. */
const escapeSearchPhrase = (value: string) =>
  JSON.stringify(value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))

/**
 * The `text ~` clause for a plain query in Jira JQL. `any` ORs every pair of the query's longest
 * terms, so a match contains at least two of them somewhere in the issue, or either term of a
 * two-term query. Jira stems text search, so a word and its plural share one term.
 */
export function jiraTextClause(text: string, match: TextMatch = 'all'): string {
  const terms = match === 'any' ? distinctTerms(text, singularKey) : []
  if (terms.length < 2) return `text ~ ${escapeSearchPhrase(text)}`
  const clause = (term: string) => `text ~ ${escapeSearchPhrase(term)}`
  const groups =
    terms.length === 2
      ? terms.map(clause)
      : terms.flatMap((first, index) =>
          terms.slice(index + 1).map((second) => `(${clause(first)} AND ${clause(second)})`)
        )
  return `(${groups.join(' OR ')})`
}

/**
 * The text clause for a plain query in Confluence CQL. `any` uses `siteSearch`, Confluence's own
 * relevance search, which ranks a page with the query's rarer words above the many pages sharing
 * one common word, where a `text ~` OR query ranks them the other way round.
 */
export function confluenceTextClause(text: string, match: TextMatch = 'all'): string {
  return `${match === 'any' ? 'siteSearch' : 'text'} ~ ${escapeSearchPhrase(text)}`
}

/** How many distinct terms occur as whole words in the text. */
export function termCoverage(text: string, terms: readonly string[]): number {
  return terms.filter((term) => findTermMatches(text, [term]).length > 0).length
}

/**
 * A test for whether a text holds at least half the query's distinct terms. Query and text words
 * are compared by their singular key, so a word and its regular plural count as one term as a
 * stemmed search matches them; a term with punctuation inside it is matched as written.
 */
export function holdsHalfTheTerms(query: string): (text: string) => boolean {
  const terms = distinctTerms(query, singularKey)
  const keys = terms.map(singularKey)
  const required = Math.ceil(terms.length / 2)
  return (text) => {
    const words = new Set(textWords(text).map(singularKey))
    const present = terms.filter(
      (term, index) => words.has(keys[index]) || findTermMatches(text, [term]).length > 0
    )
    return present.length >= required
  }
}

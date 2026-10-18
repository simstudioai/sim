import { findTermMatches, queryTerms, textWords } from '@/lib/knowledge/search/snippet'

/**
 * How a plain query's words must match a document. Confluence and Jira text search require every
 * word by default, so one word a page lacks hides it; `any` also matches pages that contain only
 * some of the query's words.
 */
export type TextMatch = 'all' | 'any'

/** Terms an any-term query sends; more would make the provider query long without adding recall. */
const MAX_ANY_TERMS = 8

/**
 * Ranking also counts two-letter words such as `AI` or `VM`: every title word counts toward the
 * title's share of query terms, so skipping them would rank a page named `AI agents` below one
 * named `Agents` for the query `AI agents`.
 */
const MIN_RANKING_TERM_LENGTH = 2

/** Words that match nearly every page, so they would make an any-term query return noise. */
const STOPWORDS = new Set([
  'about',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'should',
  'so',
  'that',
  'the',
  'their',
  'there',
  'this',
  'to',
  'up',
  'us',
  'was',
  'we',
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

/** A two-letter word written in capitals, such as `IT` or `US`, is an acronym, not a stopword. */
const isStopword = (term: string) =>
  STOPWORDS.has(term.toLowerCase()) && !(term.length === 2 && term === term.toUpperCase())

function distinctTerms(
  query: string,
  keyOf: (term: string) => string,
  minLength?: number
): string[] {
  const seen = new Set<string>()
  return queryTerms(query, minLength)
    .filter((term) => {
      const key = keyOf(term)
      if (isStopword(term) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_ANY_TERMS)
}

/**
 * One key for a word and its regular plural (`token`/`tokens`, `process`/`processes`). As in the
 * Porter stemmer, a final `-y` and `-ie(s)` fold to `i`, so `policy`/`policies` and
 * `movie`/`movies` each share a key. A word of two letters or fewer is its own key, so `OS` never
 * folds to the letter `o`.
 */
function singularKey(term: string): string {
  const key = term.toLowerCase()
  if (key.length <= 2) return key
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
 * The query's distinct terms as a stemmed search counts them, and how many of them a text holds.
 * Query and text words are compared by their singular key, so a word and its regular plural count
 * as one term; a term with punctuation inside it is matched as written.
 */
function stemmedTerms(
  query: string,
  minLength?: number
): {
  count: number
  /** At least half the terms, the minimum a partial match must hold. */
  required: number
  held: (text: string) => number
} {
  const terms = distinctTerms(query, singularKey, minLength)
  const keys = terms.map(singularKey)
  return {
    count: terms.length,
    required: Math.ceil(terms.length / 2),
    held: (text) => {
      const words = new Set(textWords(text).map(singularKey))
      return terms.filter(
        (term, index) => words.has(keys[index]) || findTermMatches(text, [term]).length > 0
      ).length
    },
  }
}

/**
 * A sort key, highest first, for comparing results from different sources against a plain query:
 * the terms the title and text hold together, then the terms the title holds, then the share of
 * the title's words that are query terms, so a page named for the query leads one that mentions it.
 * Each source ranks only its own results, so this is the comparison they share.
 */
export function queryRelevance(
  query: string
): (title: string, text: string) => [number, number, number] {
  const { held } = stemmedTerms(query, MIN_RANKING_TERM_LENGTH)
  return (title, text) => {
    const inTitle = held(title)
    return [held(`${title}\n${text}`), inTitle, inTitle / Math.max(1, textWords(title).length)]
  }
}

/**
 * A test for whether a text holds at least half the query's distinct terms, as `stemmedTerms`
 * counts them.
 */
export function holdsHalfTheTerms(query: string): (text: string) => boolean {
  const { required, held } = stemmedTerms(query)
  return (text) => held(text) >= required
}

/** Characters of a document shown under a search result. */
export const SNIPPET_LENGTH = 280
/** Characters kept before the selected match, so the hit sits in context rather than at the edge. */
const LEAD_LENGTH = 90
/** Query terms shorter than this are too common to anchor a snippet on. */
const MIN_TERM_LENGTH = 3
/** `Key: value` lines a connector writes above an email or ticket body. */
const HEADER_LINE = /^[A-Z][A-Za-z-]{1,15}: .*$/
/**
 * A character that continues a word, so a term touching one on either side is
 * part of a longer word rather than a hit. Scripts written without spaces
 * (Han, kana, Hangul, Thai) have no such edges, so their letters never
 * disqualify a neighbouring match.
 */
const WORD_CHARACTER =
  /(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Thai}])[\p{L}\p{N}_]/u

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The document text without the header block some connectors prefix (the
 * `Subject:` / `From:` / `To:` lines of an email): the title already says
 * what the subject is, and a snippet spent on the header never shows why the
 * document matched. Only a block the connector closed with a blank line
 * counts, and only when a body follows it: a chunk that is nothing but
 * `Key: value` fields, such as a calendar event, is the document.
 */
export function stripLeadingHeaders(content: string): string {
  const lines = content.split('\n')
  let index = 0
  while (index < lines.length && HEADER_LINE.test(lines[index].trim())) index += 1
  if (index === 0 || index >= lines.length || lines[index].trim() !== '') return content
  const body = lines.slice(index).join('\n')
  return body.trim() ? body : content
}

/**
 * The query's terms worth matching, longest first so the most specific one
 * wins: quotes and other search syntax around a term are not part of it.
 */
export function queryTerms(query: string | undefined): string[] {
  return [
    ...new Set(
      (query ?? '')
        .split(/\s+/)
        .map((term) => term.replace(/^["'“”‘’(]+|["'“”‘’),.;:!?]+$/g, '').trim())
        .filter((term) => term.length >= MIN_TERM_LENGTH)
    ),
  ].sort((a, b) => b.length - a.length)
}

export interface TermMatch {
  index: number
  length: number
}

/**
 * Where the query terms occur in the text as whole words, in order and without
 * overlap. Word edges are judged by the characters around a hit rather than
 * by `\b`, which knows only ASCII letters, so a term in any script still
 * matches; a hit glued to another word character on either side is not a
 * word and is skipped.
 */
export function findTermMatches(text: string, terms: readonly string[]): TermMatch[] {
  if (terms.length === 0) return []
  const pattern = new RegExp(terms.map(escapeRegExp).join('|'), 'giu')
  const matches: TermMatch[] = []
  for (const match of text.matchAll(pattern)) {
    const before = codePointBefore(text, match.index)
    const after = codePointAt(text, match.index + match[0].length)
    if (before !== undefined && WORD_CHARACTER.test(before)) continue
    if (after !== undefined && WORD_CHARACTER.test(after)) continue
    matches.push({ index: match.index, length: match[0].length })
  }
  return matches
}

/** The whole character starting at a code-unit index, or undefined past the end. */
function codePointAt(text: string, index: number): string | undefined {
  const code = text.codePointAt(index)
  return code === undefined ? undefined : String.fromCodePoint(code)
}

/** The whole character ending just before a code-unit index, or undefined at the start. */
function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined
  const unit = text.charCodeAt(index - 1)
  const start = unit >= 0xdc00 && unit <= 0xdfff && index >= 2 ? index - 2 : index - 1
  return codePointAt(text, start)
}

/** An index moved off the middle of a surrogate pair, so a slice never splits a character. */
function alignToCodePoint(text: string, index: number): number {
  const unit = text.charCodeAt(index)
  return unit >= 0xdc00 && unit <= 0xdfff ? index - 1 : index
}

/**
 * The passage of a document a search result shows: a window around the longest
 * matching query term, keeping the earliest occurrence on ties. This favors a
 * specific term in the body over a shorter title match. When no term matches,
 * the document's opening is shown. Whitespace is collapsed and the window is
 * cut on word boundaries with ellipses where the text continues.
 */
export function matchSnippet(content: string, query?: string): string {
  const flat = stripLeadingHeaders(content).replace(/\s+/g, ' ').trim()
  if (flat.length <= SNIPPET_LENGTH) return flat

  const anchor = findTermMatches(flat, queryTerms(query)).reduce<TermMatch | undefined>(
    (best, match) => (!best || match.length > best.length ? match : best),
    undefined
  )
  let start = anchor ? Math.max(0, anchor.index - LEAD_LENGTH) : 0
  if (start > 0) {
    const boundary = flat.indexOf(' ', start)
    if (boundary !== -1 && boundary - start < LEAD_LENGTH) start = boundary + 1
  }
  start = alignToCodePoint(flat, start)
  if (flat.length - start <= SNIPPET_LENGTH) {
    return `${start > 0 ? '…' : ''}${flat.slice(start)}`
  }
  let end = start + SNIPPET_LENGTH
  const lastSpace = flat.lastIndexOf(' ', end)
  if (lastSpace > start + SNIPPET_LENGTH / 2) end = lastSpace
  end = alignToCodePoint(flat, end)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trimEnd()}…`
}

/** Characters of a document shown under a search result. */
export const SNIPPET_LENGTH = 280
/** Characters kept before the first match, so the hit sits in context rather than at the edge. */
const LEAD_LENGTH = 90
/** Query terms shorter than this are too common to anchor a snippet on. */
const MIN_TERM_LENGTH = 3
/** `Key: value` lines a connector writes above an email or ticket body. */
const HEADER_LINE = /^[A-Z][A-Za-z-]{1,15}: .*$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The document text without the header block some connectors prefix (the
 * `Subject:` / `From:` / `To:` lines of an email): the title already says
 * what the subject is, and a snippet spent on the header never shows why the
 * document matched.
 */
export function stripLeadingHeaders(content: string): string {
  const lines = content.split('\n')
  let index = 0
  while (index < lines.length && HEADER_LINE.test(lines[index].trim())) index += 1
  if (index === 0) return content
  return lines.slice(index).join('\n')
}

/** The query's terms worth anchoring on, longest first so the most specific one wins. */
export function snippetTerms(query: string | undefined): string[] {
  return [
    ...new Set(
      (query ?? '')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= MIN_TERM_LENGTH)
    ),
  ].sort((a, b) => b.length - a.length)
}

/**
 * The passage of a document a search result shows: a window around the first
 * query term found, the way a search page shows why a document matched, and
 * the document's opening when no term appears in this chunk. Whitespace is
 * collapsed and the window is cut on word boundaries with ellipses where the
 * text continues.
 */
export function matchSnippet(content: string, query?: string): string {
  const flat = stripLeadingHeaders(content).replace(/\s+/g, ' ').trim()
  if (flat.length <= SNIPPET_LENGTH) return flat

  let start = 0
  for (const term of snippetTerms(query)) {
    const match = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').exec(flat)
    if (!match) continue
    start = Math.max(0, match.index - LEAD_LENGTH)
    break
  }
  if (start > 0) {
    const boundary = flat.indexOf(' ', start)
    if (boundary !== -1 && boundary - start < LEAD_LENGTH) start = boundary + 1
  }
  if (flat.length - start <= SNIPPET_LENGTH) {
    return `${start > 0 ? '…' : ''}${flat.slice(start)}`
  }
  let end = start + SNIPPET_LENGTH
  const lastSpace = flat.lastIndexOf(' ', end)
  if (lastSpace > start + SNIPPET_LENGTH / 2) end = lastSpace
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trimEnd()}…`
}

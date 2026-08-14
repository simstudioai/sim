/**
 * Collapses a multi-word phrase into a single kebab-case search token.
 *
 * Secondary search text (aliases, service names, folder paths, option labels)
 * is a space-separated list of entries, and the palette's scattered fuzzy
 * matching is confined to one whitespace-delimited word at a time. Kebab-casing
 * a multi-word entry keeps it scatter-matchable as a unit ("sndmsg" finds
 * "send-message") while a query can never be assembled letter-by-letter across
 * unrelated entries.
 */
export function toSearchToken(value: string): string {
  return value.trim().split(/\s+/).join('-')
}

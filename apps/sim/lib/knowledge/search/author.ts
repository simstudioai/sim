/**
 * The tag names connectors give the person behind a document, in the order
 * they are tried. Connectors were never asked to agree on a name, so the
 * result's author is derived here rather than in each of them.
 */
const AUTHOR_TAG_NAMES = [
  'From',
  'Author',
  'Sender',
  'Owner',
  'Organizer',
  'Creator',
  'Reporter',
  'Assignee',
] as const

/**
 * The person a search result shows beside its source: the first author-like
 * tag the document carries, reduced to a display name when the connector
 * stored an address form such as `Name <name@example.com>`.
 */
export function sourceAuthor(metadata: Record<string, unknown>): string | null {
  for (const name of AUTHOR_TAG_NAMES) {
    const value = metadata[name]
    if (typeof value !== 'string') continue
    const display = value
      .replace(/<[^>]*>/g, '')
      .trim()
      .replace(/^"|"$/g, '')
      .trim()
    if (display) return display
  }
  return null
}

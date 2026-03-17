/**
 * Strips HTML tags from content and decodes common HTML entities.
 */
export function htmlToPlainText(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Computes a SHA-256 hash of the given content string.
 * Used by connectors for change detection during sync.
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Parses a string metadata value as a Date for tag mapping.
 * Returns the Date if valid, undefined otherwise.
 */
export function parseTagDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Joins an array metadata value into a comma-separated string for tag mapping.
 * Returns the joined string if non-empty, undefined otherwise.
 */
export function joinTagArray(value: unknown): string | undefined {
  const arr = Array.isArray(value) ? (value as string[]) : []
  return arr.length > 0 ? arr.join(', ') : undefined
}

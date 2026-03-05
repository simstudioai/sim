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

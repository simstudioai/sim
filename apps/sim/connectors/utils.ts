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

/**
 * Normalizes a multi-value sourceConfig field into a trimmed, deduplicated string array.
 *
 * Accepts a string (CSV from advanced manual input or legacy single-value), an array
 * of strings (from multi-select UI or new array storage), or undefined/null. Always
 * returns a string[] — connectors call this once at the top of listDocuments to
 * branch on `values.length` for single vs multi behavior.
 */
export function parseMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
    return out
  }
  if (typeof value === 'string') {
    const seen = new Set<string>()
    const out: string[] = []
    for (const part of value.split(',')) {
      const trimmed = part.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
    return out
  }
  return []
}

/**
 * Reads a response body into a Buffer while enforcing a hard byte cap. The
 * declared `content-length` header cannot be trusted as the sole guard —
 * chunked transfer encoding may omit it entirely — so bytes are accumulated
 * from the stream and reading aborts as soon as the cap is exceeded, ensuring
 * an oversized (or hostile) body is never fully buffered into memory.
 * Returns null when the cap is exceeded.
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<Buffer | null> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.byteLength > maxBytes ? null : buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

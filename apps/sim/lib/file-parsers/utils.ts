/**
 * A bare `[\uD800-\uDFFF]` class would match both halves of a *valid* pair,
 * deleting every non-BMP character rather than only the malformed ones.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Strips control characters, replacement characters, and unpaired surrogates so
 * the text is safe for UTF-8 storage in PostgreSQL. Tabs, newlines, and carriage
 * returns are preserved.
 */
export function sanitizeTextForUTF8(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(UNPAIRED_SURROGATE, '')
}

/** Formats the inline `[... detail ...]` marker parsers append when a limit stopped extraction early. */
export function truncationNotice(detail: string): string {
  return `\n[... ${detail} ...]\n`
}

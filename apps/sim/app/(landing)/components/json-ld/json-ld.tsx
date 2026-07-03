import type { ReactElement } from 'react'

/**
 * Characters that break out of an inline HTML `<script>` context, mapped to
 * their unicode escapes. `<` is the dangerous one (`</script>`); `>` and `&` are
 * escaped for completeness, and the JS line/paragraph separators (U+2028/U+2029)
 * keep the payload valid inside inline scripts.
 */
const HTML_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [String.fromCharCode(0x2028)]: '\\u2028',
  [String.fromCharCode(0x2029)]: '\\u2029',
}

const UNSAFE_HTML_CHARS = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g')

/**
 * Serialize structured data for an inline `application/ld+json` script. Plain
 * `JSON.stringify` does not HTML-escape, so a `</script>` (or stray `<`) in the
 * data would break out of the script tag and become an XSS sink. Escaping these
 * characters as unicode escapes keeps the JSON valid and semantically identical,
 * so crawlers read the exact same graph — SEO output is unchanged.
 */
function serializeJsonLd(data: JsonLdData): string {
  return JSON.stringify(data).replace(UNSAFE_HTML_CHARS, (char) => HTML_ESCAPES[char])
}

export type JsonLdData = Record<string, unknown>

interface JsonLdProps {
  data: JsonLdData
}

/**
 * Server-rendered JSON-LD `<script>`. The single source of truth for emitting
 * structured data across the landing surface — every page/section passes its
 * schema graph as `data` and this owns the safe serialization. Render it in a
 * Server Component before visible content so crawlers and AI answer engines read
 * the graph first.
 */
export function JsonLd({ data }: JsonLdProps): ReactElement {
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}

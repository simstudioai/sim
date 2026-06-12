import { truncate } from '@sim/utils/string'

/**
 * Sanitize URLs for logging by stripping query/hash and truncating.
 */
export function sanitizeUrlForLog(url: string, maxLength = 120): string {
  if (!url) return ''

  const trimmed = url.trim()
  try {
    const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    const parsed = new URL(trimmed, hasProtocol ? undefined : 'http://localhost')
    const origin = parsed.origin === 'null' ? '' : parsed.origin
    const sanitized = `${origin}${parsed.pathname}`
    const result = sanitized || parsed.pathname || trimmed
    return truncate(result, maxLength)
  } catch {
    const withoutQuery = trimmed.split('?')[0].split('#')[0]
    return truncate(withoutQuery, maxLength)
  }
}

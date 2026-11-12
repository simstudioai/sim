/**
 * Reads SES message tags passed as an array or, from agent tool calls, as a JSON
 * array string. Anything else is left unset; the request contract validates the
 * tag names and values.
 */
export function parseEmailTagsParam(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

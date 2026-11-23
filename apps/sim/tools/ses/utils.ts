const EMAIL_TAGS_FORMAT_ERROR = 'Email tags must be a valid JSON array of {"name", "value"} objects'

/**
 * Reads SES message tags passed as an array or, from agent tool calls, as a JSON
 * array string. Empty values are left unset; a string that is not a JSON array
 * throws, matching the block. The request contract validates names and values.
 */
export function parseEmailTagsParam(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(EMAIL_TAGS_FORMAT_ERROR)
  }
  if (!Array.isArray(parsed)) throw new Error(EMAIL_TAGS_FORMAT_ERROR)
  return parsed
}

/**
 * Normalize a tags input into a clean string array.
 *
 * Tags can arrive either as a comma-separated string (typed into the block's
 * text input) or as a string array (when wired from another block's JSON
 * output, e.g. the tags returned by a get/append/replace tags operation).
 */
export function normalizeTags(input: string | string[] | undefined | null): string[] {
  if (Array.isArray(input)) {
    return input.map((tag) => String(tag).trim()).filter(Boolean)
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  return []
}

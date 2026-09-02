/**
 * Reads a stored folder value into a canonical percent-encoded path.
 *
 * The picker stores a plain string, but the manual half of the pair is a text
 * field, so a reference like `<block.folderPath>` resolves to a string before it
 * gets here. A JSON array is tolerated because an earlier revision of this
 * control stored one, and reading only its first entry is closer to the intent
 * than discarding the value.
 */
export function readFolderPath(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('[')) {
      try {
        return readFolderPath(JSON.parse(trimmed))
      } catch {
        return trimmed
      }
    }
    return trimmed
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.length > 0)
    return typeof first === 'string' ? first : ''
  }
  return ''
}

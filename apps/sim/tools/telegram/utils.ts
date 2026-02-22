export function convertMarkdownToHTML(text: string): string {
  return (
    text
      // Bold: **text** or __text__ -> <b>text</b>
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/__(.*?)__/g, '<b>$1</b>')
      // Italic: *text* or _text_ -> <i>text</i>
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      // Code: `text` -> <code>text</code>
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // Links: [text](url) -> <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  )
}

const DEFAULT_MULTIPLE_MEDIA_ERROR =
  'Media reference must be a single value, not an array. Use <block.files[0]> to select one file.'

function extractUrlFromFileLike(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const url = (value as { url?: unknown }).url
  if (typeof url !== 'string') return undefined
  const trimmed = url.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Normalizes a "Telegram media" parameter that can be:
 * - a plain string (file_id, URL)
 * - a UserFile-like object with a `url`
 * - a JSON-stringified file object/array (advanced mode)
 */
export function normalizeTelegramMediaParam(
  value: unknown,
  options?: { single?: boolean; errorMessage?: string }
): string | string[] | undefined {
  if (value === null || value === undefined) return undefined

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined

    // Only attempt JSON parsing for object/array payloads.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed)
      } catch {
        return options?.single ? trimmed : [trimmed]
      }
    } else {
      return options?.single ? trimmed : [trimmed]
    }
  }

  const values: unknown[] = Array.isArray(value) ? value : [value]
  const normalized = values
    .map((v) => {
      if (typeof v === 'string') {
        const trimmed = v.trim()
        return trimmed.length > 0 ? trimmed : undefined
      }
      return extractUrlFromFileLike(v)
    })
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (normalized.length === 0) return undefined

  if (options?.single) {
    if (normalized.length > 1) {
      throw new Error(options.errorMessage ?? DEFAULT_MULTIPLE_MEDIA_ERROR)
    }
    return normalized[0]
  }

  return normalized
}

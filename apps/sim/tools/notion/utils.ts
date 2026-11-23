/**
 * Clamp a Notion `page_size` value to the API's supported 1-100 range. Returns
 * undefined when the input isn't a finite number so callers can omit the param.
 */
export function clampNotionPageSize(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(Math.max(Math.trunc(parsed), 1), 100)
}

export function formatPropertyValue(property: any): string {
  switch (property.type) {
    case 'title':
      return property.title?.map((t: any) => t.plain_text || '').join('') || ''
    case 'rich_text':
      return property.rich_text?.map((t: any) => t.plain_text || '').join('') || ''
    case 'number':
      return String(property.number || '')
    case 'select':
      return property.select?.name || ''
    case 'multi_select':
      return property.multi_select?.map((s: any) => s.name).join(', ') || ''
    case 'date':
      return property.date?.start || ''
    case 'checkbox':
      return property.checkbox ? 'Yes' : 'No'
    case 'url':
      return property.url || ''
    case 'email':
      return property.email || ''
    case 'phone_number':
      return property.phone_number || ''
    default:
      return JSON.stringify(property)
  }
}

export function extractTitle(properties: Record<string, any>): string {
  for (const [, value] of Object.entries(properties)) {
    if (
      value.type === 'title' &&
      value.title &&
      Array.isArray(value.title) &&
      value.title.length > 0
    ) {
      return value.title.map((t: any) => t.plain_text || '').join('')
    }
  }
  return ''
}

export function extractTitleFromItem(item: any): string {
  if (item.object === 'page') {
    const title = item.properties ? extractTitle(item.properties) : ''
    return title || item.title || 'Untitled Page'
  }
  if (item.object === 'database') {
    if (item.title && Array.isArray(item.title)) {
      return item.title.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'
    }
    return 'Untitled Database'
  }
  return 'Untitled'
}

/** Notion's per-object `text.content` limit for rich text (request limits). */
const NOTION_RICH_TEXT_MAX_CHARS = 2000

/** Notion's maximum element count for any array in a request body. */
const NOTION_MAX_ARRAY_ELEMENTS = 100

/**
 * Build a plain-text rich text array, splitting `content` into objects of at most
 * 2000 characters so long text is not rejected with a `validation_error`. A
 * surrogate pair is never split across two objects.
 */
export function toNotionRichText(
  value: unknown
): Array<{ type: 'text'; text: { content: string } }> {
  const content =
    typeof value === 'string'
      ? value
      : value !== null && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value ?? '')
  const chunks: string[] = []
  let index = 0
  while (index < content.length) {
    let end = Math.min(index + NOTION_RICH_TEXT_MAX_CHARS, content.length)
    if (end < content.length) {
      const lastCode = content.charCodeAt(end - 1)
      if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1
    }
    chunks.push(content.slice(index, end))
    index = end
  }
  if (chunks.length === 0) chunks.push('')
  if (chunks.length > NOTION_MAX_ARRAY_ELEMENTS) {
    throw new Error(
      `Content is too long for one Notion rich text value (max ${NOTION_RICH_TEXT_MAX_CHARS * NOTION_MAX_ARRAY_ELEMENTS} characters)`
    )
  }
  return chunks.map((chunk) => ({ type: 'text', text: { content: chunk } }))
}

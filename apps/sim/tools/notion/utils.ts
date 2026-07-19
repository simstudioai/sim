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
    // For pages, check properties first
    if (item.properties?.title?.title && Array.isArray(item.properties.title.title)) {
      const title = item.properties.title.title.map((t: any) => t.plain_text || '').join('')
      if (title) return title
    }
    // Fallback to page title
    return item.title || 'Untitled Page'
  }
  if (item.object === 'database') {
    // For databases, get title from title array
    if (item.title && Array.isArray(item.title)) {
      return item.title.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'
    }
    return 'Untitled Database'
  }
  return 'Untitled'
}

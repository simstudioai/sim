import type { StructuredFilter } from '@/lib/knowledge/types'

/**
 * Document tag entry format used in create_document tool.
 */
export interface DocumentTagEntry {
  tagName: string
  value: string
}

/**
 * Tag filter entry format used in search tool.
 */
export interface TagFilterEntry {
  tagName: string
  tagSlot?: string
  tagValue: string | number | boolean
  fieldType?: string
  operator?: string
  valueTo?: string | number
}

/**
 * Checks if a tag value is effectively empty (unfilled/default entry).
 */
function isEmptyTagEntry(entry: Record<string, unknown>): boolean {
  if (!entry.tagName || (typeof entry.tagName === 'string' && entry.tagName.trim() === '')) {
    return true
  }
  return false
}

/**
 * Checks if a tag-based value is effectively empty (only contains default/unfilled entries).
 */
export function isEmptyTagValue(value: unknown): boolean {
  if (!value) return true

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) return false
      if (parsed.length === 0) return true
      return parsed.every((entry: Record<string, unknown>) => isEmptyTagEntry(entry))
    } catch {
      return false
    }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return true
    return value.every((entry: Record<string, unknown>) => isEmptyTagEntry(entry))
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) return true
    return entries.every(([, val]) => val === undefined || val === null || val === '')
  }

  return false
}

/**
 * Filters valid document tags from an array, removing empty entries.
 */
function filterValidDocumentTags(tags: unknown[]): DocumentTagEntry[] {
  return tags
    .filter((entry): entry is Record<string, unknown> => {
      if (typeof entry !== 'object' || entry === null) return false
      const e = entry as Record<string, unknown>
      if (!e.tagName || (typeof e.tagName === 'string' && e.tagName.trim() === '')) return false
      if (e.value === undefined || e.value === null || e.value === '') return false
      return true
    })
    .map((entry) => ({
      tagName: String(entry.tagName),
      value: String(entry.value),
    }))
}

/**
 * Parses document tags from various formats into a normalized array format.
 */
export function parseDocumentTags(value: unknown): DocumentTagEntry[] {
  if (!value) return []

  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return Object.entries(value)
      .filter(([tagName, tagValue]) => {
        if (!tagName || tagName.trim() === '') return false
        if (tagValue === undefined || tagValue === null || tagValue === '') return false
        return true
      })
      .map(([tagName, tagValue]) => ({
        tagName,
        value: String(tagValue),
      }))
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return filterValidDocumentTags(parsed)
      }
    } catch {
      return []
    }
    return []
  }

  if (Array.isArray(value)) {
    return filterValidDocumentTags(value)
  }

  return []
}

/**
 * Parses tag filters from various formats into a normalized StructuredFilter array.
 */
export function parseTagFilters(value: unknown): StructuredFilter[] {
  if (!value) return []

  let tagFilters = value

  if (typeof tagFilters === 'string') {
    try {
      tagFilters = JSON.parse(tagFilters)
    } catch {
      return []
    }
  }

  if (!Array.isArray(tagFilters)) return []

  return tagFilters
    .filter((filter): filter is Record<string, unknown> => {
      if (typeof filter !== 'object' || filter === null) return false
      const f = filter as Record<string, unknown>
      if (!f.tagName || (typeof f.tagName === 'string' && f.tagName.trim() === '')) return false
      if (f.fieldType === 'boolean') {
        return f.tagValue !== undefined
      }
      if (f.tagValue === undefined || f.tagValue === null) return false
      if (typeof f.tagValue === 'string' && f.tagValue.trim().length === 0) return false
      return true
    })
    .map((filter) => ({
      tagName: filter.tagName as string,
      tagSlot: (filter.tagSlot as string) || '',
      fieldType: (filter.fieldType as string) || 'text',
      operator: (filter.operator as string) || 'eq',
      value: filter.tagValue as string | number | boolean,
      valueTo: filter.valueTo as string | number | undefined,
    }))
}

/**
 * Converts parsed document tags to the format expected by the create document API.
 */
export function formatDocumentTagsForAPI(tags: DocumentTagEntry[]): { documentTagsData?: string } {
  if (tags.length === 0) return {}
  return {
    documentTagsData: JSON.stringify(tags),
  }
}

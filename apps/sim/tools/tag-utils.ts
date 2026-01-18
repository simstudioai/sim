/**
 * Unified tag validation and parsing utilities for knowledge tools.
 * Handles document tags and tag filters in various input formats.
 */

import type { StructuredFilter } from '@/lib/knowledge/types'

/**
 * Document tag entry format used in create_document tool
 */
export interface DocumentTagEntry {
  tagName: string
  value: string
}

/**
 * Tag filter entry format used in search tool
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
 * Checks if a tag value is effectively empty (unfilled/default entry)
 */
function isEmptyTagEntry(entry: Record<string, unknown>): boolean {
  // Check tagName for both document tags and tag filters
  if (!entry.tagName || (typeof entry.tagName === 'string' && entry.tagName.trim() === '')) {
    return true
  }
  return false
}

/**
 * Checks if a tag-based value is effectively empty (only contains default/unfilled entries).
 * Works for both documentTags and tagFilters parameters in various formats.
 *
 * @param value - The tag value to check (can be JSON string, array, or object)
 * @returns true if the value is empty or only contains unfilled entries
 */
export function isEmptyTagValue(value: unknown): boolean {
  if (!value) return true

  // Handle JSON string format
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

  // Handle array format directly
  if (Array.isArray(value)) {
    if (value.length === 0) return true
    return value.every((entry: Record<string, unknown>) => isEmptyTagEntry(entry))
  }

  // Handle object format (LLM format: { "Category": "foo", "Priority": 5 })
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) return true
    // Object format is considered non-empty if it has any keys with values
    return entries.every(([, val]) => val === undefined || val === null || val === '')
  }

  return false
}

/**
 * Parses document tags from various formats into a normalized array format.
 * Used by create_document tool to handle tags from both UI and LLM sources.
 *
 * @param value - Document tags in object, array, or JSON string format
 * @returns Normalized array of document tag entries, or empty array if invalid
 *
 * @example
 * // Object format from LLM
 * parseDocumentTags({ "Category": "Planning", "Priority": 5 })
 * // Returns: [{ tagName: "Category", value: "Planning" }, { tagName: "Priority", value: "5" }]
 *
 * @example
 * // JSON string format from UI
 * parseDocumentTags('[{"tagName":"Category","value":"Planning"}]')
 * // Returns: [{ tagName: "Category", value: "Planning" }]
 *
 * @example
 * // Array format directly
 * parseDocumentTags([{ tagName: "Category", value: "Planning" }])
 * // Returns: [{ tagName: "Category", value: "Planning" }]
 */
export function parseDocumentTags(value: unknown): DocumentTagEntry[] {
  if (!value) return []

  // Handle object format from LLM: { "Category": "foo", "Priority": 5 }
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return Object.entries(value)
      .filter(([tagName, tagValue]) => {
        // Filter out empty entries
        if (!tagName || tagName.trim() === '') return false
        if (tagValue === undefined || tagValue === null || tagValue === '') return false
        return true
      })
      .map(([tagName, tagValue]) => ({
        tagName,
        value: String(tagValue),
      }))
  }

  // Handle JSON string format from UI
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return filterValidDocumentTags(parsed)
      }
    } catch {
      // Invalid JSON, return empty
    }
    return []
  }

  // Handle array format directly
  if (Array.isArray(value)) {
    return filterValidDocumentTags(value)
  }

  return []
}

/**
 * Filters valid document tags from an array, removing empty entries
 */
function filterValidDocumentTags(tags: unknown[]): DocumentTagEntry[] {
  return tags
    .filter((entry): entry is Record<string, unknown> => {
      if (typeof entry !== 'object' || entry === null) return false
      const e = entry as Record<string, unknown>
      // Must have non-empty tagName
      if (!e.tagName || (typeof e.tagName === 'string' && e.tagName.trim() === '')) return false
      // Must have a value
      if (e.value === undefined || e.value === null || e.value === '') return false
      return true
    })
    .map((entry) => ({
      tagName: String(entry.tagName),
      value: String(entry.value),
    }))
}

/**
 * Parses tag filters from various formats into a normalized StructuredFilter array.
 * Used by search tool to handle tag filters from both UI and LLM sources.
 *
 * @param value - Tag filters in array or JSON string format
 * @returns Normalized array of structured filters, or empty array if invalid
 *
 * @example
 * // Array format with full filter objects
 * parseTagFilters([{ tagName: "Status", tagValue: "Active", operator: "eq" }])
 *
 * @example
 * // JSON string format from UI
 * parseTagFilters('[{"tagName":"Status","tagValue":"Active"}]')
 */
export function parseTagFilters(value: unknown): StructuredFilter[] {
  if (!value) return []

  let tagFilters = value

  // Handle JSON string format
  if (typeof tagFilters === 'string') {
    try {
      tagFilters = JSON.parse(tagFilters)
    } catch {
      return []
    }
  }

  // Must be an array at this point
  if (!Array.isArray(tagFilters)) return []

  return tagFilters
    .filter((filter): filter is Record<string, unknown> => {
      if (typeof filter !== 'object' || filter === null) return false
      const f = filter as Record<string, unknown>

      // Must have tagName
      if (!f.tagName || (typeof f.tagName === 'string' && f.tagName.trim() === '')) return false

      // For boolean field type, any value is valid
      if (f.fieldType === 'boolean') {
        return f.tagValue !== undefined
      }

      // For other types, check for non-empty string value
      if (f.tagValue === undefined || f.tagValue === null) return false
      if (typeof f.tagValue === 'string' && f.tagValue.trim().length === 0) return false

      return true
    })
    .map((filter) => ({
      tagName: filter.tagName as string,
      tagSlot: (filter.tagSlot as string) || '', // Will be resolved by API from tagName
      fieldType: (filter.fieldType as string) || 'text',
      operator: (filter.operator as string) || 'eq',
      value: filter.tagValue as string | number | boolean,
      valueTo: filter.valueTo as string | number | undefined,
    }))
}

/**
 * Converts parsed document tags to the format expected by the create document API.
 * Returns the documentTagsData JSON string if there are valid tags.
 *
 * @param tags - Parsed document tag entries
 * @returns Object with documentTagsData property, or empty object if no tags
 */
export function formatDocumentTagsForAPI(tags: DocumentTagEntry[]): { documentTagsData?: string } {
  if (tags.length === 0) return {}
  return {
    documentTagsData: JSON.stringify(tags),
  }
}

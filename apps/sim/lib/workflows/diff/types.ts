/**
 * Type definitions for workflow diff functionality
 */

export type DiffStatus = 'new' | 'edited' | undefined

export type FieldDiffStatus = 'changed' | 'unchanged'

export type EdgeDiffStatus = 'new' | 'deleted' | 'unchanged' | null

export interface BlockWithDiff {
  is_diff?: DiffStatus
  field_diffs?: Record<string, { changed_fields: string[]; unchanged_fields: string[] }>
}

export function hasDiffStatus(block: any): block is BlockWithDiff {
  return block && typeof block === 'object' && ('is_diff' in block || 'field_diffs' in block)
}

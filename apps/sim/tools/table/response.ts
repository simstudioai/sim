import { dryRunId } from '@/tools/dry-run'

/** Table output schemas expose operation status to downstream workflow references. */
export function tableSuccess<T extends Record<string, unknown>>(
  output: T
): { success: true; output: T & { success: true } } {
  return { success: true, output: { ...output, success: true } }
}

/** The timestamp a dry run's placeholder row carries: the request cannot know when it is written. */
const PLACEHOLDER_ROW_TIMESTAMP = '1970-01-01T00:00:00.000Z'

/**
 * A dry run's placeholder for a row a table write returns: the data the call writes (before schema
 * coercion, every key kept), and placeholders for the id, position and timestamps the table would
 * assign.
 */
export function placeholderRow(data: unknown, position: number, id?: string) {
  return {
    id: id ?? dryRunId('row', position + 1),
    data,
    position,
    createdAt: PLACEHOLDER_ROW_TIMESTAMP,
    updatedAt: PLACEHOLDER_ROW_TIMESTAMP,
  }
}

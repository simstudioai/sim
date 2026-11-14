import { toStringOrNull } from '@sim/utils/coerce'

function position(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Reads the pagination fields DocuSign returns as strings on list responses
 * (`startPosition`, `endPosition`, `nextUri`).
 */
export function listPagination(data: Record<string, unknown>) {
  return {
    startPosition: position(data.startPosition),
    endPosition: position(data.endPosition),
    nextUri: toStringOrNull(data.nextUri) || null,
  }
}

import { isRecordLike } from '@sim/utils/object'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/**
 * The row ids a drag carries, written to and read from `dataTransfer` as JSON under a
 * private MIME type.
 *
 * The payload has to live on the event rather than only in component state: a drag survives
 * the source row unmounting — spring-loading navigates away mid-drag — and it can be released
 * over a different mount of the same page.
 *
 * Each surface passes its own MIME so a drag from one list is never mistaken for a drag from
 * another, and so an unrelated OS drag is ignored outright.
 */

/** Writes `rowIds` under `mime`, plus a plain-text fallback for drops outside the app. */
export function writeRowDragPayload(
  dataTransfer: DataTransfer,
  mime: string,
  rowIds: string[],
  owner?: EditableFileOwner
): void {
  dataTransfer.setData(mime, JSON.stringify(owner ? { owner, rowIds } : rowIds))
  dataTransfer.setData('text/plain', rowIds.join(','))
}

/**
 * Reads the row ids back, returning `null` when the payload is absent (a foreign drag) or
 * malformed rather than throwing mid-drop. Owner-scoped readers require an exact pair and
 * must not replace a rejected payload with an in-memory source.
 */
export function readRowDragPayload(
  dataTransfer: DataTransfer,
  mime: string,
  owner?: EditableFileOwner
): string[] | null {
  const raw = dataTransfer.getData(mime)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (owner) {
      if (
        !isRecordLike(parsed) ||
        !isRecordLike(parsed.owner) ||
        parsed.owner.entityType !== owner.entityType ||
        parsed.owner.entityId !== owner.entityId ||
        !Array.isArray(parsed.rowIds) ||
        !parsed.rowIds.every((id): id is string => typeof id === 'string' && id.length > 0)
      ) {
        return null
      }
      return parsed.rowIds.length > 0 ? parsed.rowIds : null
    }
    if (!Array.isArray(parsed)) return null
    const rowIds = parsed.filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    return rowIds.length > 0 ? rowIds : null
  } catch {
    return null
  }
}

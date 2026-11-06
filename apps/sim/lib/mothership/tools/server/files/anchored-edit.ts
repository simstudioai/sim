import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import type { WorkspaceFileContentEdit } from '@/lib/workspace-files/edit-content'

type AnchoredContentEdit = Exclude<WorkspaceFileContentEdit, { mode: 'search_replace' }>

/**
 * Maps a staged `anchored` patch onto the shared workspace-file edit, so the
 * durable write and its streamed preview apply the same anchor semantics.
 */
export function toAnchoredContentEdit(
  edit: Record<string, unknown>,
  content: string
): { edit: AnchoredContentEdit } | { error: string } {
  const read = (key: string) => toStringOrNull(edit[key]) ?? ''
  const occurrence = toNumberOrNull(edit.occurrence) ?? undefined

  switch (edit.mode) {
    case 'replace_between': {
      const beforeAnchor = read('before_anchor')
      const afterAnchor = read('after_anchor')
      if (!beforeAnchor || !afterAnchor) {
        return { error: 'replace_between requires before_anchor and after_anchor' }
      }
      return { edit: { mode: 'replace_between', beforeAnchor, afterAnchor, content, occurrence } }
    }
    case 'insert_after': {
      const anchor = read('anchor')
      if (!anchor) return { error: 'insert_after requires anchor' }
      return { edit: { mode: 'insert_after', anchor, content, occurrence } }
    }
    case 'delete_between': {
      const startAnchor = read('start_anchor')
      const endAnchor = read('end_anchor')
      if (!startAnchor || !endAnchor) {
        return { error: 'delete_between requires start_anchor and end_anchor' }
      }
      return { edit: { mode: 'delete_between', startAnchor, endAnchor, occurrence } }
    }
    default:
      return { error: `Unknown anchored patch mode: "${String(edit.mode)}"` }
  }
}

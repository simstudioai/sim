import type { ChatContext } from '@/stores/panel'

/**
 * Custom clipboard MIME type carrying a selection {@link ChatContext} so a
 * highlighted passage copied from a file/table can be pasted into the Chat input
 * as a reference chip. Written alongside `text/plain` (never replacing it), so
 * pasting anywhere else still yields the plain selection text.
 */
export const SIM_SELECTION_MIME = 'text/x-sim-selection'

/**
 * Attaches a selection context to a copy event's clipboard. Adds the custom MIME
 * type WITHOUT calling `preventDefault`, so the editor's own copy handler (Monaco,
 * ProseMirror) still writes `text/plain`/`text/html` — the custom type simply
 * rides along on the shared `DataTransfer`.
 */
export function attachSelectionContextToClipboard(
  clipboardData: DataTransfer | null,
  context: ChatContext
): void {
  if (!clipboardData) return
  try {
    clipboardData.setData(SIM_SELECTION_MIME, JSON.stringify(context))
  } catch {
    // Some browsers reject custom types mid-gesture; degrade to plain-text copy.
  }
}

/**
 * Reads a selection context previously written by
 * {@link attachSelectionContextToClipboard}, or null when the clipboard carries
 * no (or an invalid) selection payload.
 */
export function readSelectionContextFromClipboard(
  clipboardData: DataTransfer | null
): ChatContext | null {
  const raw = clipboardData?.getData(SIM_SELECTION_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ChatContext
    if (!parsed || typeof parsed.label !== 'string') return null
    // Require each kind's resolving field so a chip never pastes only to
    // resolve to nothing server-side.
    if (parsed.kind === 'file_selection' && typeof parsed.text === 'string' && parsed.fileId) {
      return parsed
    }
    if (
      parsed.kind === 'table_selection' &&
      parsed.tableId &&
      Array.isArray(parsed.rowIds) &&
      parsed.rowIds.length > 0
    ) {
      return parsed
    }
  } catch {
    // Malformed payload — fall back to plain-text paste.
  }
  return null
}

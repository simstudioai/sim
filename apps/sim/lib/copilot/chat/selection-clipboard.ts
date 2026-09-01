import type { ChatContext } from '@/stores/panel'

/**
 * Custom clipboard MIME type carrying a selection {@link ChatContext} so a
 * highlighted passage copied from a file/table can be pasted into the Chat input
 * as a reference chip. Written alongside `text/plain` (never replacing it), so
 * pasting anywhere else still yields the plain selection text.
 */
export const SIM_SELECTION_MIME = 'text/x-sim-selection'

const SIM_SELECTION_CLIPBOARD_VERSION = 1

interface SelectionClipboardEnvelope {
  version: typeof SIM_SELECTION_CLIPBOARD_VERSION
  sourceWorkspaceId: string
  context: ChatContext
}

/**
 * Attaches a selection context to a copy event's clipboard. Adds the custom MIME
 * type WITHOUT calling `preventDefault`, so the editor's own copy handler (Monaco,
 * ProseMirror) still writes `text/plain`/`text/html` — the custom type simply
 * rides along on the shared `DataTransfer`.
 */
export function attachSelectionContextToClipboard(
  clipboardData: DataTransfer | null,
  context: ChatContext,
  sourceWorkspaceId: string
): void {
  if (!clipboardData || !sourceWorkspaceId) return
  try {
    const envelope: SelectionClipboardEnvelope = {
      version: SIM_SELECTION_CLIPBOARD_VERSION,
      sourceWorkspaceId,
      context,
    }
    clipboardData.setData(SIM_SELECTION_MIME, JSON.stringify(envelope))
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
  clipboardData: DataTransfer | null,
  destinationWorkspaceId: string
): ChatContext | null {
  const raw = clipboardData?.getData(SIM_SELECTION_MIME)
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<SelectionClipboardEnvelope>
    if (
      envelope.version !== SIM_SELECTION_CLIPBOARD_VERSION ||
      envelope.sourceWorkspaceId !== destinationWorkspaceId
    ) {
      return null
    }
    const parsed = envelope.context
    if (!parsed || typeof parsed !== 'object' || typeof parsed.label !== 'string') return null
    // Require each kind's resolving field so a chip never pastes only to
    // resolve to nothing server-side.
    if (
      parsed.kind === 'file_selection' &&
      typeof parsed.text === 'string' &&
      typeof parsed.fileName === 'string' &&
      parsed.fileId
    ) {
      return parsed
    }
    if (
      parsed.kind === 'table_selection' &&
      parsed.tableId &&
      typeof parsed.tableName === 'string' &&
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

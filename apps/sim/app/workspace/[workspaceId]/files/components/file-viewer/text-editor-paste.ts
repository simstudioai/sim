import { assessTextPaste, PASTE_LIMITS, type TextPasteAdmission } from '@sim/utils/paste'

interface TextEditorPasteInput {
  pastedText: string
  currentText: string
  selectionStart: number
  selectionEnd: number
}

/** Applies the workspace-file content contract to a projected Monaco paste result. */
export function assessTextEditorPaste(
  input: TextEditorPasteInput,
  maxBytes = PASTE_LIMITS.TEXT_EDITOR_BYTES
): TextPasteAdmission {
  return assessTextPaste({
    ...input,
    maxPastedBytes: maxBytes,
    maxResultBytes: maxBytes,
  })
}

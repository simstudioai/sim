/**
 * Type of dropdown insertion that determines the delimiter pair used
 * for cursor position computation.
 */
export type InsertionType = 'tag' | 'envVar'

/**
 * Restores the cursor position in a textarea after a tag or env-var
 * dropdown insertion. Computes where the inserted token ends in the
 * new value and places the cursor right after it.
 *
 * @param textarea - The textarea element to restore cursor in
 * @param liveValue - The textarea value before the insertion
 * @param liveCursor - The cursor position before the insertion
 * @param newValue - The full new value after the insertion
 * @param type - The type of insertion ('tag' for `<>`, 'envVar' for `{{}}`)
 */
export function restoreCursorAfterInsertion(
  textarea: HTMLTextAreaElement | null,
  liveValue: string,
  liveCursor: number,
  newValue: string,
  type: InsertionType
): void {
  const [openDelim, closeDelim, closeLen] =
    type === 'tag' ? (['<', '>', 1] as const) : (['{{', '}}', 2] as const)

  const insertPos = liveValue.slice(0, liveCursor).lastIndexOf(openDelim)
  const searchFrom = insertPos !== -1 ? insertPos : liveCursor
  const closingPos = newValue.indexOf(closeDelim, searchFrom)
  const newCursorPos = closingPos !== -1 ? closingPos + closeLen : newValue.length

  setTimeout(() => {
    if (textarea) {
      textarea.focus()
      textarea.selectionStart = newCursorPos
      textarea.selectionEnd = newCursorPos
    }
  }, 0)
}

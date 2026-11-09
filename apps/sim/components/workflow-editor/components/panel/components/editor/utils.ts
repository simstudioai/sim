/**
 * Restores the cursor position in a textarea after a dropdown insertion.
 * Schedules a macrotask (via setTimeout) that runs after React's controlled-component commit
 * so that the cursor position sticks.
 *
 * @param textarea - The textarea element to restore cursor in (may be null)
 * @param newCursorPosition - The exact position to place the cursor at
 */
export function restoreCursorAfterInsertion(
  textarea: HTMLTextAreaElement | null,
  newCursorPosition: number
): void {
  setTimeout(() => {
    if (textarea) {
      textarea.focus()
      textarea.selectionStart = newCursorPosition
      textarea.selectionEnd = newCursorPosition
    }
  }, 0)
}

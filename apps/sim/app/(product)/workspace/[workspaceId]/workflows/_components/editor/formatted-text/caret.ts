/** Puts the caret back after React commits a picker's insertion, so it lands after the text. */
export function placeCaret(textarea: HTMLTextAreaElement | null, position: number) {
  setTimeout(() => {
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = position
    textarea.selectionEnd = position
  })
}

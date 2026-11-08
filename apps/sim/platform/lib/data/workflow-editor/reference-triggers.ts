/**
 * When a field's caret should open a reference picker. The legacy editor keeps the tag trigger in
 * its dropdown view module; these are the same rules, held here so input logic never bundles a
 * legacy view.
 */

/** An unclosed `<` before the caret opens the `<block.output>` picker. */
export function checkTagTrigger(text: string, cursorPosition: number): { show: boolean } {
  if (cursorPosition >= 1) {
    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
    const lastCloseBracket = textBeforeCursor.lastIndexOf('>')
    if (lastOpenBracket !== -1 && (lastCloseBracket === -1 || lastCloseBracket < lastOpenBracket)) {
      return { show: true }
    }
  }
  return { show: false }
}

/** The lowercase text between the last unclosed `<` and the caret, or empty outside a tag. */
export function getTagSearchTerm(text: string, cursorPosition: number): string {
  if (cursorPosition <= 0) return ''
  const textBeforeCursor = text.slice(0, cursorPosition)
  const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
  if (lastOpenBracket === -1) return ''
  const lastCloseBracket = textBeforeCursor.lastIndexOf('>')
  if (lastCloseBracket > lastOpenBracket) return ''
  return textBeforeCursor.slice(lastOpenBracket + 1).toLowerCase()
}

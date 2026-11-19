/** Replace `before.slice(start, end)` with `text` to turn `before` into the new text. */
export interface TextEdit {
  start: number
  end: number
  text: string
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * The single smallest edit from `before` to `after`: everything between their common prefix and
 * common suffix. Null when they are equal. The edit never splits a surrogate pair, so each end
 * lands on a character boundary the editor can map to a position.
 */
export function minimalTextEdit(before: string, after: string): TextEdit | null {
  if (before === after) return null
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix--
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix--
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  }
}

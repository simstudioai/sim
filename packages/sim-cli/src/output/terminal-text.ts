/**
 * Grapheme-aware terminal text primitives.
 *
 * Extracted from the chat terminal because they are pure and have no dependency
 * on it: width, truncation, padding and cursor-index arithmetic that correctly
 * handle combining marks, emoji and East Asian wide characters. `output/render`
 * previously carried weaker copies that measured by string length.
 */
const RESET = `${String.fromCharCode(27)}[0m`

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function graphemes(value: string): Array<{ segment: string; index: number }> {
  return [...GRAPHEME_SEGMENTER.segment(value)].map(({ segment, index }) => ({ segment, index }))
}
/** First grapheme cluster of a string, or null when it is empty. */
export function firstGrapheme(value: string): string | null {
  return GRAPHEME_SEGMENTER.segment(value)[Symbol.iterator]().next().value?.segment ?? null
}

export function previousGraphemeIndex(value: string, cursor: number): number {
  let previous = 0
  for (const part of graphemes(value)) {
    if (part.index >= cursor) break
    previous = part.index
  }
  return previous
}
export function nextGraphemeIndex(value: string, cursor: number): number {
  for (const part of graphemes(value)) {
    if (part.index > cursor) return part.index
    if (part.index === cursor) return part.index + part.segment.length
  }
  return value.length
}
export function lineStart(value: string, cursor: number): number {
  const newline = value.lastIndexOf('\n', Math.max(0, cursor - 1))
  return newline < 0 ? 0 : newline + 1
}
export function lineEnd(value: string, cursor: number): number {
  const newline = value.indexOf('\n', cursor)
  return newline < 0 ? value.length : newline
}
export function displayWidth(value: string): number {
  let width = 0
  for (const part of graphemes(value.replace(/\u001b\[[0-9;:]*m/gu, ''))) {
    width += graphemeWidth(part.segment)
  }
  return width
}
export function graphemeWidth(value: string): number {
  if (!value || value === '\n') return 0
  if (/^\p{Mark}+$/u.test(value)) return 0
  if (value.includes('\u200d') || /\p{Extended_Pictographic}/u.test(value)) return 2
  const codePoint = value.codePointAt(0) ?? 0
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  return isWideCodePoint(codePoint) ? 2 : 1
}
export function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  )
}
export function truncateDisplay(value: string, width: number): string {
  if (displayWidth(value) <= width) return value
  const target = Math.max(0, width - 1)
  let result = ''
  let used = 0
  for (const part of graphemes(value)) {
    const partWidth = displayWidth(part.segment)
    if (used + partWidth > target) break
    result += part.segment
    used += partWidth
  }
  return `${result}…${RESET}`
}
export function tailToWidth(value: string, width: number): string {
  if (displayWidth(value) <= width) return value
  const target = Math.max(0, width - 1)
  const parts = graphemes(value)
  let result = ''
  let used = 0
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const partWidth = displayWidth(part.segment)
    if (used + partWidth > target) break
    result = `${part.segment}${result}`
    used += partWidth
  }
  return `…${result}`
}
/** Squares off a ragged art line so every box border starts at the same column. */
export function artPad(line: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(line)))
}

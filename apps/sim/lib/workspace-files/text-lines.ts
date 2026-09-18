import { detectLineEnding } from '@/lib/workspace-files/edit-content'

export interface FileTextLineRange {
  offset: number
  lineCount: number
  totalLines: number
  totalLinesExact: boolean
}

/** Counts logical lines in place and retains only the requested window, without a per-line array. */
export function sliceFileTextLines(
  text: string,
  offset: number | undefined,
  limit: number | undefined,
  truncatedExtraction: boolean
): { text: string; lineRange?: FileTextLineRange } {
  if (offset === undefined && limit === undefined) return { text }
  const start = Math.max((offset ?? 1) - 1, 0)
  const end = limit === undefined ? Number.POSITIVE_INFINITY : start + Math.max(0, limit)
  let totalLines = 0
  let lineCount = 0
  let position = 0
  let windowStart = 0
  let windowEnd = 0
  do {
    const newline = text.indexOf('\n', position)
    const lineEnd = newline < 0 ? text.length : newline
    if (totalLines >= start && totalLines < end) {
      if (lineCount === 0) windowStart = position
      windowEnd = newline >= 0 && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
      lineCount++
    }
    totalLines++
    if (newline < 0) break
    position = newline + 1
  } while (position < text.length)

  return {
    text:
      lineCount === 0
        ? ''
        : text.slice(windowStart, windowEnd).replace(/\r?\n/g, detectLineEnding(text)),
    lineRange: { offset: start + 1, lineCount, totalLines, totalLinesExact: !truncatedExtraction },
  }
}

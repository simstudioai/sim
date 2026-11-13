/** Characters one standard read returns, the page budget indexed document reads use. */
export const READ_WINDOW_CHARACTERS = 8000

/** Times a window is shortened to fit its budget before the minimum is used instead. */
const MAX_SHRINKS = 3

/**
 * Where a window of `content` from `start` ends so its text, as JSON encodes it, fits `budget`
 * characters. JSON escapes quotes, backslashes and line breaks, so a window is shortened until its
 * encoded text fits. It never ends before `minimumEnd`.
 */
export function encodedWindowEnd(
  content: string,
  start: number,
  budget: number,
  minimumEnd: number
): number {
  let end = Math.min(content.length, start + budget)
  for (let shrinks = 0; end > minimumEnd; shrinks++) {
    const encoded = JSON.stringify(content.slice(start, end)).length - 2
    if (encoded <= budget) return end
    if (shrinks === MAX_SHRINKS) break
    end = start + Math.floor(((end - start) * budget) / encoded)
  }
  return minimumEnd
}

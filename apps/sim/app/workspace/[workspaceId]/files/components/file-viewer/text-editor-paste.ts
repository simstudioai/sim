import {
  PASTE_LIMITS,
  type TextPasteAdmission,
  utf8ByteLength,
  utf8ByteLengthRange,
} from '@sim/utils/paste'

interface TextEditorPasteSelection {
  start: number
  end: number
}

interface TextEditorPasteInput {
  pastedText: string
  currentText: string
  selections: readonly TextEditorPasteSelection[]
  multiCursorPaste?: 'spread' | 'full'
}

function normalizedSelections(
  selections: readonly TextEditorPasteSelection[],
  textLength: number
): TextEditorPasteSelection[] {
  const source = selections.length > 0 ? selections : [{ start: textLength, end: textLength }]
  return source
    .map(({ start, end }) => ({
      start: Math.min(Math.max(Math.min(start, end), 0), textLength),
      end: Math.min(Math.max(Math.max(start, end), 0), textLength),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

function mergedReplacementRanges(
  selections: readonly TextEditorPasteSelection[]
): TextEditorPasteSelection[] {
  const ranges: TextEditorPasteSelection[] = []
  for (const selection of selections) {
    if (selection.start === selection.end) continue
    const previous = ranges.at(-1)
    if (previous && selection.start <= previous.end) {
      previous.end = Math.max(previous.end, selection.end)
    } else {
      ranges.push({ ...selection })
    }
  }
  return ranges
}

function distributedPasteRanges(
  text: string,
  selectionCount: number
): TextEditorPasteSelection[] | null {
  if (selectionCount <= 1) return null

  let textEnd = text.length
  if (text.charCodeAt(textEnd - 1) === 10) textEnd -= 1
  if (text.charCodeAt(textEnd - 1) === 13) textEnd -= 1

  const ranges: TextEditorPasteSelection[] = []
  let lineStart = 0
  for (let index = 0; index < textEnd; index++) {
    const code = text.charCodeAt(index)
    if (code !== 10 && code !== 13) continue
    ranges.push({ start: lineStart, end: index })
    if (ranges.length >= selectionCount) return null
    if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1
    lineStart = index + 1
  }
  ranges.push({ start: lineStart, end: textEnd })
  return ranges.length === selectionCount ? ranges : null
}

/** Applies the workspace-file content contract to every selection in a projected Monaco paste. */
export function assessTextEditorPaste(
  input: TextEditorPasteInput,
  maxBytes = PASTE_LIMITS.TEXT_EDITOR_BYTES
): TextPasteAdmission {
  const selections = normalizedSelections(input.selections, input.currentText.length)
  const replacementRanges = mergedReplacementRanges(selections)
  const distributedRanges =
    (input.multiCursorPaste ?? 'spread') === 'spread'
      ? distributedPasteRanges(input.pastedText, selections.length)
      : null
  const replacedCharacters = replacementRanges.reduce(
    (total, selection) => total + selection.end - selection.start,
    0
  )
  const insertedCharacters = distributedRanges
    ? distributedRanges.reduce((total, range) => total + range.end - range.start, 0)
    : input.pastedText.length * selections.length
  const resultCharacters = input.currentText.length - replacedCharacters + insertedCharacters

  if (!distributedRanges && input.pastedText.length > maxBytes) {
    return {
      accepted: false,
      reason: 'pasted-bytes',
      actual: input.pastedText.length,
      limit: maxBytes,
    }
  }

  if (resultCharacters <= Math.floor(maxBytes / 3)) {
    return { accepted: true, resultCharacters }
  }

  const pastedBytes = distributedRanges ? undefined : utf8ByteLength(input.pastedText, maxBytes)
  if (pastedBytes !== undefined && pastedBytes > maxBytes) {
    return { accepted: false, reason: 'pasted-bytes', actual: pastedBytes, limit: maxBytes }
  }

  const insertedBytes = distributedRanges
    ? distributedRanges.reduce(
        (total, range) =>
          total + utf8ByteLengthRange(input.pastedText, range.start, range.end, maxBytes - total),
        0
      )
    : (pastedBytes ?? 0) * selections.length
  if (insertedBytes > maxBytes) {
    return { accepted: false, reason: 'result-bytes', actual: insertedBytes, limit: maxBytes }
  }

  let retainedBytes = 0
  let retainedStart = 0
  for (const selection of replacementRanges) {
    retainedBytes += utf8ByteLengthRange(
      input.currentText,
      retainedStart,
      selection.start,
      maxBytes - insertedBytes - retainedBytes
    )
    if (retainedBytes + insertedBytes > maxBytes) {
      return {
        accepted: false,
        reason: 'result-bytes',
        actual: retainedBytes + insertedBytes,
        limit: maxBytes,
      }
    }
    retainedStart = selection.end
  }
  retainedBytes += utf8ByteLengthRange(
    input.currentText,
    retainedStart,
    input.currentText.length,
    maxBytes - insertedBytes - retainedBytes
  )

  const resultBytes = retainedBytes + insertedBytes
  if (resultBytes > maxBytes) {
    return { accepted: false, reason: 'result-bytes', actual: resultBytes, limit: maxBytes }
  }

  return { accepted: true, pastedBytes, resultBytes, resultCharacters }
}

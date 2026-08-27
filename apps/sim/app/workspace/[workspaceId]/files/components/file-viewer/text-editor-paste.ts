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

/** Applies the workspace-file content contract to every selection in a projected Monaco paste. */
export function assessTextEditorPaste(
  input: TextEditorPasteInput,
  maxBytes = PASTE_LIMITS.TEXT_EDITOR_BYTES
): TextPasteAdmission {
  const selections = normalizedSelections(input.selections, input.currentText.length)
  const replacementRanges = mergedReplacementRanges(selections)
  const replacedCharacters = replacementRanges.reduce(
    (total, selection) => total + selection.end - selection.start,
    0
  )
  const resultCharacters =
    input.currentText.length - replacedCharacters + input.pastedText.length * selections.length

  if (resultCharacters <= Math.floor(maxBytes / 3)) {
    return { accepted: true, resultCharacters }
  }

  const pastedBytes = utf8ByteLength(input.pastedText, maxBytes)
  if (pastedBytes > maxBytes) {
    return { accepted: false, reason: 'pasted-bytes', actual: pastedBytes, limit: maxBytes }
  }

  const insertedBytes = pastedBytes * selections.length
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

import { diffLines, diffWordsWithSpace } from 'diff'

/** Lines of context kept around each change before the rest folds away. */
export const CONTEXT_LINES = 2
/** An unchanged run shorter than this is never worth folding. */
export const MIN_FOLD_LINES = 4
/**
 * A body that is entirely one side (a new block's code, a removed block's
 * prompt) has no unchanged run to fold, so it shows this many lines and
 * tucks the rest behind one expander instead of swallowing the card.
 */
export const ONE_SIDED_VISIBLE_LINES = 12
/** Past this share of changed characters a line pair is a rewrite, not an edit, so no word marks. */
const MAX_WORD_HIGHLIGHT_RATIO = 0.6
/**
 * Word diffing is quadratic in the worst case; a pair of lines longer than
 * this together is shown as plain removed and added lines instead of
 * stalling the pane on a pathological prompt.
 */
const MAX_WORD_DIFF_CHARS = 4000
/**
 * Word marks only help when a line pair differs by a few words, so the word
 * diff gives up past this many edits. That caps each pair's work at a small
 * multiple of its length, so many long, heavily rewritten line pairs cannot
 * add up to a stall the way a per-line size limit alone would allow.
 */
const MAX_WORD_EDITS = 64
/**
 * Line diffing is quadratic in the worst case too; two bodies with more lines
 * than this between them are summarized instead of diffed so opening a
 * comparison never hangs the tab.
 */
export const MAX_DIFF_LINES = 2000

export interface DiffLine {
  kind: 'added' | 'removed' | 'context'
  text: string
  /** Word-level parts when this line pairs with its counterpart on the other side */
  parts?: Array<{ value: string; changed: boolean }>
}

export type DiffRow =
  | { type: 'line'; line: DiffLine }
  | { type: 'fold'; lines: DiffLine[] }
  | { type: 'tail'; lines: DiffLine[] }
  | { type: 'oversized'; oldLines: number; newLines: number }

/**
 * Pairs each run of removed lines with the run of added lines that follows it,
 * line by line, and marks the words that differ within each pair. A one-word
 * edit inside a long sentence then reads as that word, not as the whole line
 * leaving and coming back. Whitespace counts as a word so an indentation-only
 * edit still shows.
 */
export function markWordChanges(lines: DiffLine[]): DiffLine[] {
  const out = [...lines]
  let index = 0
  while (index < out.length) {
    if (out[index].kind !== 'removed') {
      index += 1
      continue
    }
    let removedEnd = index
    while (removedEnd < out.length && out[removedEnd].kind === 'removed') removedEnd += 1
    let addedEnd = removedEnd
    while (addedEnd < out.length && out[addedEnd].kind === 'added') addedEnd += 1
    const pairs = Math.min(removedEnd - index, addedEnd - removedEnd)
    for (let offset = 0; offset < pairs; offset += 1) {
      const removed = out[index + offset]
      const added = out[removedEnd + offset]
      const total = removed.text.length + added.text.length
      if (total === 0 || total > MAX_WORD_DIFF_CHARS) continue
      const words = diffWordsWithSpace(removed.text, added.text, {
        maxEditLength: MAX_WORD_EDITS,
      })
      if (!words) continue
      const changedChars = words
        .filter((part) => part.added || part.removed)
        .reduce((sum, part) => sum + part.value.length, 0)
      if (changedChars / total > MAX_WORD_HIGHLIGHT_RATIO) continue
      out[index + offset] = {
        ...removed,
        parts: words
          .filter((part) => !part.added)
          .map((part) => ({ value: part.value, changed: Boolean(part.removed) })),
      }
      out[removedEnd + offset] = {
        ...added,
        parts: words
          .filter((part) => !part.removed)
          .map((part) => ({ value: part.value, changed: Boolean(part.added) })),
      }
    }
    index = addedEnd
  }
  return out
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

export function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function toLines(oldText: string, newText: string): DiffLine[] {
  const out: DiffLine[] = []
  for (const part of diffLines(oldText, newText)) {
    const kind: DiffLine['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'context'
    for (const text of splitLines(part.value)) out.push({ kind, text })
  }
  return out
}

/** Folds long unchanged runs, keeping a little context on either side of each change. */
export function foldRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = []
  let run: DiffLine[] = []
  const flush = (isTail: boolean) => {
    if (run.length === 0) return
    const head = rows.length === 0 ? 0 : CONTEXT_LINES
    const tail = isTail ? 0 : CONTEXT_LINES
    if (run.length - head - tail >= MIN_FOLD_LINES) {
      for (const line of run.slice(0, head)) rows.push({ type: 'line', line })
      rows.push({ type: 'fold', lines: run.slice(head, run.length - tail) })
      for (const line of run.slice(run.length - tail)) rows.push({ type: 'line', line })
    } else {
      for (const line of run) rows.push({ type: 'line', line })
    }
    run = []
  }
  for (const line of lines) {
    if (line.kind === 'context') {
      run.push(line)
    } else {
      flush(false)
      rows.push({ type: 'line', line })
    }
  }
  flush(true)
  return rows
}

/** Caps a body that is all added or all removed at a visible head plus one expander for the rest. */
export function capOneSided(lines: DiffLine[]): DiffRow[] {
  const oneSided =
    lines.length > 0 &&
    lines[0].kind !== 'context' &&
    lines.every((line) => line.kind === lines[0].kind)
  if (!oneSided || lines.length <= ONE_SIDED_VISIBLE_LINES) return foldRows(lines)
  return [
    ...lines.slice(0, ONE_SIDED_VISIBLE_LINES).map((line): DiffRow => ({ type: 'line', line })),
    { type: 'tail', lines: lines.slice(ONE_SIDED_VISIBLE_LINES) },
  ]
}

/**
 * The rows a text diff renders for two bodies: line diff, word marks, folds and
 * the one-sided cap, or a single summary row when the bodies are too long to
 * diff inline.
 */
export function buildDiffRows(rawOld: string, rawNew: string): DiffRow[] {
  /* Stored text may carry CRLF or bare CR endings; diff them as the lines they display as. */
  const oldText = normalizeLineEndings(rawOld)
  const newText = normalizeLineEndings(rawNew)
  const oldLines = splitLines(oldText).length
  const newLines = splitLines(newText).length
  if (oldLines + newLines > MAX_DIFF_LINES) return [{ type: 'oversized', oldLines, newLines }]
  return capOneSided(markWordChanges(toLines(oldText, newText)))
}

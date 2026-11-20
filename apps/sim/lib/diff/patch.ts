import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs'
import type { DiffHunk, UnifiedDiff } from '@/lib/diff/unified'

/** Marks a break between hunks that has no heading of its own. */
const UNNAMED_HUNK = '⋯'

/**
 * One side of a hunk header and the line after it. A header's own start is kept verbatim
 * (for an empty side it names the line before the change, as unified diffs do); a hunk
 * without one is placed at `next`.
 */
function side(
  headerStart: number | undefined,
  next: number,
  count: number
): { range: string; next: number } {
  if (headerStart !== undefined)
    return {
      range: `${headerStart},${count}`,
      next: (count === 0 ? headerStart + 1 : headerStart) + count,
    }
  return { range: `${count === 0 ? next - 1 : next},${count}`, next: next + count }
}

/**
 * Writes one file's hunks back out as a well-formed patch. Agent-written diffs often omit hunk
 * line numbers, which Pierre requires, so a hunk without them is placed after the hunk before
 * it. Pierre draws a hunk's heading only above a gap, so such a hunk that has a heading, or
 * follows another, starts one line later; the caller hides line numbers in that case, so the
 * invented ones never show.
 */
function serializeFile(name: string, hunks: DiffHunk[]): string {
  const rows = [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`]
  let nextOld = 1
  let nextNew = 1
  for (const [index, hunk] of hunks.entries()) {
    const gap = hunk.heading || index > 0 ? 1 : 0
    const oldSide = side(
      hunk.range?.oldStart,
      nextOld + gap,
      hunk.lines.filter((line) => line.type !== 'add').length
    )
    const newSide = side(
      hunk.range?.newStart,
      nextNew + gap,
      hunk.lines.filter((line) => line.type !== 'del').length
    )
    rows.push(`@@ -${oldSide.range} +${newSide.range} @@${hunk.heading ? ` ${hunk.heading}` : ''}`)
    for (const line of hunk.lines)
      rows.push(`${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`)
    nextOld = oldSide.next
    nextNew = newSide.next
  }
  return rows.join('\n')
}

/**
 * Pierre's file diffs for a parsed unified diff, one per file. Each hunk separator shows the
 * hunk's heading rather than its raw `@@` range.
 */
export function toFileDiffs(diff: UnifiedDiff, fallbackName: string): FileDiffMetadata[] {
  const files = new Map<string, DiffHunk[]>()
  for (const hunk of diff.hunks) {
    const name = hunk.file ?? diff.path ?? fallbackName
    files.set(name, [...(files.get(name) ?? []), hunk])
  }
  const patch = [...files].map(([name, hunks]) => serializeFile(name, hunks)).join('\n')
  /* Render the lines in the order they were written, not realigned by similarity. */
  return parsePatchFiles(patch, { disableLineMatching: true })
    .flatMap((parsed) => parsed.files)
    .map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => ({ ...hunk, hunkSpecs: hunk.hunkContext || UNNAMED_HUNK })),
    }))
}

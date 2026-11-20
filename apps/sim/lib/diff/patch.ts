import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs'
import type { DiffHunk, UnifiedDiff } from '@/lib/diff/unified'

/** Marks a break between hunks that has no heading of its own. */
const UNNAMED_HUNK = '⋯'

function hunkRange(start: number, count: number): string {
  return `${count === 0 ? Math.max(start - 1, 0) : start},${count}`
}

/**
 * Writes one file's hunks back out as a well-formed patch. Agent-written diffs often omit hunk
 * line numbers, which Pierre requires, so a hunk without them is numbered after the hunk
 * before it. Pierre draws a hunk's heading only above a gap, so a hunk that has a heading, or
 * follows another, starts one line later; the caller hides line numbers in that case, so the
 * invented ones never show.
 */
function serializeFile(name: string, hunks: DiffHunk[]): string {
  const rows = [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`]
  let nextOld = 1
  let nextNew = 1
  for (const [index, hunk] of hunks.entries()) {
    const gap = hunk.heading || index > 0 ? 1 : 0
    const oldStart = hunk.lines.find((line) => line.oldLine !== undefined)?.oldLine ?? nextOld + gap
    const newStart = hunk.lines.find((line) => line.newLine !== undefined)?.newLine ?? nextNew + gap
    const oldCount = hunk.lines.filter((line) => line.type !== 'add').length
    const newCount = hunk.lines.filter((line) => line.type !== 'del').length
    rows.push(
      `@@ -${hunkRange(oldStart, oldCount)} +${hunkRange(newStart, newCount)} @@${hunk.heading ? ` ${hunk.heading}` : ''}`
    )
    for (const line of hunk.lines)
      rows.push(`${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`)
    nextOld = oldStart + oldCount
    nextNew = newStart + newCount
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
  return parsePatchFiles(patch)
    .flatMap((parsed) => parsed.files)
    .map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk) => ({ ...hunk, hunkSpecs: hunk.hunkContext || UNNAMED_HUNK })),
    }))
}

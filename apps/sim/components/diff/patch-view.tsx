'use client'

import { type CSSProperties, useMemo } from 'react'
import { type FileDiffOptions, parsePatchFiles } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { useTheme } from 'next-themes'
import type { DiffHunk, UnifiedDiff } from '@/lib/diff/unified'

interface PatchViewProps {
  diff: UnifiedDiff
  /** Names the file when the diff carries no path, so its language is still inferred. */
  fallbackName: string
  wrapLines: boolean
}

/**
 * Maps Sim's tokens onto Pierre's custom properties. Custom properties inherit through the
 * component's shadow root, so this is the one place the diff takes Sim's palette and fonts.
 */
const SIM_DIFF_THEME = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-season)',
  '--diffs-font-size': '13px',
  '--diffs-line-height': '22px',
  '--diffs-bg-context-override': 'var(--surface-2)',
  '--diffs-bg-context-gutter-override': 'var(--surface-2)',
  '--diffs-bg-separator-override': 'var(--surface-3)',
  '--diffs-bg-buffer-override': 'var(--surface-3)',
  '--diffs-addition-color-override': 'var(--badge-success-text)',
  '--diffs-deletion-color-override': 'var(--badge-error-text)',
  '--diffs-bg-addition-override':
    'color-mix(in srgb, var(--badge-success-bg) 18%, var(--surface-2))',
  '--diffs-bg-addition-number-override':
    'color-mix(in srgb, var(--badge-success-bg) 18%, var(--surface-2))',
  '--diffs-bg-addition-emphasis-override':
    'color-mix(in srgb, var(--badge-success-bg) 70%, transparent)',
  '--diffs-bg-deletion-override': 'color-mix(in srgb, var(--badge-error-bg) 18%, var(--surface-2))',
  '--diffs-bg-deletion-number-override':
    'color-mix(in srgb, var(--badge-error-bg) 18%, var(--surface-2))',
  '--diffs-bg-deletion-emphasis-override':
    'color-mix(in srgb, var(--badge-error-bg) 70%, transparent)',
  '--diffs-fg-number-override': 'var(--text-muted)',
} as CSSProperties

function hunkRange(start: number, count: number): string {
  return `${count === 0 ? Math.max(start - 1, 0) : start},${count}`
}

/**
 * Pierre takes its base background from the syntax theme and sets it inline, so only an
 * `!important` rule inside its shadow root puts the diff on Sim's card surface.
 */
const SIM_SURFACE_CSS =
  ':host, pre { --diffs-light-bg: var(--surface-2) !important; --diffs-dark-bg: var(--surface-2) !important; }'

/**
 * Writes one file's hunks back out as a well-formed patch. Agent-written diffs often omit hunk
 * line numbers, which Pierre requires, so a hunk without them starts one line past the hunk
 * before it: the one-line gap is what makes Pierre draw the separator carrying its heading. The
 * caller hides line numbers in that case, so the invented ones never show.
 */
function serializeFile(name: string, hunks: DiffHunk[]): string {
  const rows = [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`]
  let nextOld = 1
  let nextNew = 1
  for (const hunk of hunks) {
    const oldStart = hunk.lines.find((line) => line.oldLine !== undefined)?.oldLine ?? nextOld + 1
    const newStart = hunk.lines.find((line) => line.newLine !== undefined)?.newLine ?? nextNew + 1
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

function toPatch(diff: UnifiedDiff, fallbackName: string): string {
  const files = new Map<string, DiffHunk[]>()
  for (const hunk of diff.hunks) {
    const name = hunk.file ?? diff.path ?? fallbackName
    files.set(name, [...(files.get(name) ?? []), hunk])
  }
  return [...files].map(([name, hunks]) => serializeFile(name, hunks)).join('\n')
}

/**
 * A code diff rendered by Pierre: syntax highlighted by file type, with word-level changes and
 * collapsible context. A multi-file git diff renders one titled section per file; a single file
 * relies on the card header the embed already draws.
 */
export function PatchView({ diff, fallbackName, wrapLines }: PatchViewProps) {
  const { forcedTheme, resolvedTheme } = useTheme()
  const numbered = diff.hunks.some((hunk) =>
    hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
  )
  const files = useMemo(() => {
    const parsed = parsePatchFiles(toPatch(diff, fallbackName)).flatMap((patch) => patch.files)
    if (numbered) return parsed
    return parsed.map((file) => ({
      ...file,
      hunks: file.hunks.map((hunk, index) => ({
        ...hunk,
        hunkSpecs: hunk.hunkContext || (index > 0 ? '⋯' : undefined),
      })),
    }))
  }, [diff, fallbackName, numbered])
  const options: FileDiffOptions<undefined, undefined> = {
    diffStyle: 'unified',
    diffIndicators: 'bars',
    lineDiffType: 'word',
    overflow: wrapLines ? 'wrap' : 'scroll',
    themeType: (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light',
    disableLineNumbers: !numbered,
    disableFileHeader: files.length === 1,
    hunkSeparators: 'metadata',
    unsafeCSS: SIM_SURFACE_CSS,
  }
  return (
    <div style={SIM_DIFF_THEME}>
      {files.map((file, index) => (
        <FileDiff key={`${index}:${file.name}`} fileDiff={file} options={options} />
      ))}
    </div>
  )
}

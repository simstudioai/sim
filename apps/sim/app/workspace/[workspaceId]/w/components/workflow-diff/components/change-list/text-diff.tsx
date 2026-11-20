'use client'

import { useMemo, useState } from 'react'
import { parseDiffFromFile } from '@pierre/diffs'
import { Button, cn } from '@sim/emcn'
import { diffWordsWithSpace } from 'diff'
import { SimFileDiff } from '@/components/diff/sim-file-diff'

/**
 * Line diffing is quadratic in the worst case; two bodies with more lines than this between
 * them are summarized instead of diffed, so opening a comparison never hangs the tab.
 */
const MAX_DIFF_LINES = 2000
/** Unchanged lines kept around each change; the rest fold behind Pierre's expanders. */
const CONTEXT_LINES = 2
/**
 * A body that is entirely one side (a new block's code, a removed block's prompt) has no
 * unchanged run to fold, so it shows this many lines and tucks the rest behind one expander.
 */
const ONE_SIDED_VISIBLE_LINES = 12
/** Past this many changed regions, one control expands or collapses them all. */
const MANY_REGIONS = 3

/**
 * A field value as the lines it displays as: CRLF and bare CR become LF, and the text ends in
 * a newline, so a missing final newline is never reported as a change of its own.
 */
function asLines(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  return normalized === '' || normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function lineCount(text: string): number {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length
}

function firstLines(text: string, count: number): string {
  return `${text.split('\n').slice(0, count).join('\n')}\n`
}

interface TextDiffProps {
  oldText: string
  newText: string
  /** Syntax for highlighting, such as `javascript` or `json`; `text` for prose. */
  language: string
}

/**
 * A unified line diff of two bodies of text, highlighted in the field's language. Unchanged
 * runs fold to a count and expand in place, so a long prompt shows only the hunks that moved.
 */
export function TextDiff({ oldText, newText, language }: TextDiffProps) {
  const before = asLines(oldText)
  const after = asLines(newText)
  const oldLines = lineCount(before)
  const newLines = lineCount(after)
  const oneSidedLines = before === '' ? newLines : after === '' ? oldLines : 0
  const [showRest, setShowRest] = useState(false)
  const [expandAll, setExpandAll] = useState(false)
  /* Expansion belongs to one pair of bodies; a new comparison starts folded again. */
  const [expandedFor, setExpandedFor] = useState({ before, after })
  if (expandedFor.before !== before || expandedFor.after !== after) {
    setExpandedFor({ before, after })
    setShowRest(false)
    setExpandAll(false)
  }
  const capped = oneSidedLines > ONE_SIDED_VISIBLE_LINES && !showRest
  const oversized = oldLines + newLines > MAX_DIFF_LINES
  const fileDiff = useMemo(() => {
    if (oversized) return null
    /* An empty side is absent, not one blank line, so a new or removed body is all one side. */
    const side = (name: string, text: string) =>
      text === ''
        ? null
        : {
            name,
            contents: capped ? firstLines(text, ONE_SIDED_VISIBLE_LINES) : text,
            lang: language,
          }
    return parseDiffFromFile(side('before', before), side('after', after), {
      context: CONTEXT_LINES,
    })
  }, [before, after, language, capped, oversized])

  if (!fileDiff)
    return (
      <p className='text-[var(--text-tertiary)] text-caption'>
        Too long to compare line by line: {oldLines} lines before, {newLines} lines after.
      </p>
    )

  const regions = fileDiff.hunks.length
  /* Normalizing endings can leave nothing to show for a value that did change. */
  if (regions === 0)
    return <p className='text-[var(--text-secondary)] text-small'>Only line endings changed</p>

  return (
    <div className='overflow-hidden rounded-sm border border-[var(--border-1)]'>
      {regions > MANY_REGIONS && (
        <Button
          type='button'
          variant='quiet'
          size='sm'
          onClick={() => setExpandAll((value) => !value)}
          className='w-full justify-between rounded-none border-[var(--border-1)] border-b text-left'
        >
          <span>{regions} changed regions</span>
          <span>{expandAll ? 'Collapse unchanged' : 'Show all lines'}</span>
        </Button>
      )}
      <SimFileDiff
        fileDiff={fileDiff}
        options={{
          disableFileHeader: true,
          disableLineNumbers: true,
          expandUnchanged: expandAll,
          hunkSeparators: 'line-info',
        }}
      />
      {capped && (
        <Button
          type='button'
          variant='quiet'
          size='sm'
          onClick={() => setShowRest(true)}
          className='w-full justify-start rounded-none border-[var(--border-1)] border-t text-left'
        >
          {oneSidedLines - ONE_SIDED_VISIBLE_LINES} more{' '}
          {oneSidedLines - ONE_SIDED_VISIBLE_LINES === 1 ? 'line' : 'lines'}
        </Button>
      )}
    </div>
  )
}

interface InlineDiffProps {
  oldText: string
  newText: string
}

/**
 * Word-level diff on one line, for short values where a before and after row
 * would waste the space: removed words sit muted on a red tint, added words
 * on a green tint.
 */
export function InlineDiff({ oldText, newText }: InlineDiffProps) {
  // Whitespace counts, so a value that differs only by a space still shows where.
  const parts = useMemo(() => diffWordsWithSpace(oldText, newText), [oldText, newText])
  return (
    <span className='whitespace-pre-wrap break-words text-[var(--text-primary)] text-small'>
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added && 'rounded-xs bg-[var(--badge-success-bg)] px-0.5',
            part.removed &&
              'rounded-xs bg-[var(--badge-error-bg)] px-0.5 text-[var(--text-tertiary)]'
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  )
}

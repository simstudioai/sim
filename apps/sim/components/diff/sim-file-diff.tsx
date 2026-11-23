'use client'

import type { CSSProperties } from 'react'
import type { FileDiffMetadata, FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { DIFF_SURFACE, usePierreThemeType } from '@/components/code-editor/pierre-theme'

/** Sim's surface tokens plus its change colors; row and word tints derive from the two colors. */
const DIFF_TOKENS = {
  ...DIFF_SURFACE.tokens,
  '--diffs-addition-color-override': 'var(--badge-success-text)',
  '--diffs-deletion-color-override': 'var(--badge-error-text)',
} as CSSProperties

/** What a surface decides; everything else is the same for every diff Sim renders. */
type SimFileDiffOptions = Pick<
  FileDiffOptions<undefined, undefined>,
  'disableFileHeader' | 'disableLineNumbers' | 'expandUnchanged' | 'hunkSeparators'
>

interface SimFileDiffProps {
  fileDiff: FileDiffMetadata
  wrapLines?: boolean
  options?: SimFileDiffOptions
}

/**
 * One file's changes in Sim's diff style: unified, with `+`/`−` markers, word-level emphasis
 * and Sim's syntax colors. Every diff surface renders through this so they stay identical.
 */
export function SimFileDiff({ fileDiff, wrapLines = true, options }: SimFileDiffProps) {
  const themeType = usePierreThemeType()
  return (
    <FileDiff
      fileDiff={fileDiff}
      style={DIFF_TOKENS}
      options={{
        ...options,
        ...DIFF_SURFACE.options,
        themeType,
        diffStyle: 'unified',
        diffIndicators: 'classic',
        lineDiffType: 'word-alt',
        overflow: wrapLines ? 'wrap' : 'scroll',
      }}
    />
  )
}

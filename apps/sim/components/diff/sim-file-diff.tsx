'use client'

import '@sim/emcn/components/code/code.css'
import type { CSSProperties } from 'react'
import { type FileDiffMetadata, type FileDiffOptions, registerCustomTheme } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { buildSyntaxTheme, CODE_TOKEN_COLORS } from '@sim/emcn/syntax-theme'
import { useTheme } from 'next-themes'

const SYNTAX_THEME = 'sim-code'

/**
 * Pierre highlights with Shiki, so it takes Sim's syntax colors as a TextMate theme built on
 * `code.css`'s variables: diffs color code exactly like `Code` does, in both themes.
 */
registerCustomTheme(SYNTAX_THEME, async () =>
  buildSyntaxTheme(SYNTAX_THEME, 'light', {
    ...CODE_TOKEN_COLORS,
    background: 'var(--surface-2)',
  })
)

/**
 * Maps Sim's surfaces, change colors and fonts onto Pierre's custom properties, which inherit
 * through its shadow root. Row and word tints derive from the two change colors.
 */
const DIFF_TOKENS = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-season)',
  '--diffs-font-size': '13px',
  '--diffs-line-height': '22px',
  '--diffs-bg-context-override': 'var(--surface-2)',
  '--diffs-bg-context-gutter-override': 'var(--surface-2)',
  '--diffs-bg-separator-override': 'var(--surface-3)',
  '--diffs-bg-buffer-override': 'var(--surface-3)',
  '--diffs-fg-number-override': 'var(--text-muted)',
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
  const { forcedTheme, resolvedTheme } = useTheme()
  return (
    <FileDiff
      fileDiff={fileDiff}
      style={DIFF_TOKENS}
      options={{
        ...options,
        theme: { light: SYNTAX_THEME, dark: SYNTAX_THEME },
        themeType: (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light',
        diffStyle: 'unified',
        diffIndicators: 'classic',
        lineDiffType: 'word-alt',
        overflow: wrapLines ? 'wrap' : 'scroll',
      }}
    />
  )
}

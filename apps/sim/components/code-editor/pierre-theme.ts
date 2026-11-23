'use client'

import '@sim/emcn/components/code/code.css'
import type { CSSProperties } from 'react'
import {
  type BaseCodeOptions,
  canUseWASM,
  registerCustomTheme,
  type ThemeTypes,
} from '@pierre/diffs'
import { buildCodeTokenZedTheme, buildSyntaxTheme, CODE_TOKEN_COLORS } from '@sim/emcn/syntax-theme'
import { useTheme } from 'next-themes'

/**
 * Highlights tokenizes in slices around what is on screen, so a 30,000-line file never blocks
 * the main thread the way a whole-file Shiki pass does. Only one backend runs per page, so every
 * Pierre surface uses this one; Shiki remains for browsers without WebAssembly SIMD.
 */
const PREFERRED_HIGHLIGHTER =
  typeof window !== 'undefined' && !canUseWASM() ? 'shiki-js' : 'highlights'

interface CodeSurface {
  /** Pierre's `theme` and highlighter options. */
  options: Pick<BaseCodeOptions, 'theme' | 'preferredHighlighter'>
  /** Sim's fonts and surfaces as Pierre's custom properties, inherited through its shadow root. */
  tokens: CSSProperties
}

/**
 * Sim's syntax colors on one background, for both highlighter backends. Built on `code.css`'s
 * variables, so Pierre colors code exactly like `Code` does, in both themes.
 */
function codeSurface(name: string, background: string): CodeSurface {
  registerCustomTheme(name, async () =>
    buildSyntaxTheme(name, 'light', { ...CODE_TOKEN_COLORS, background })
  )
  registerCustomTheme(name, async () => buildCodeTokenZedTheme(name, background), 'zed')
  return {
    options: { theme: { light: name, dark: name }, preferredHighlighter: PREFERRED_HIGHLIGHTER },
    tokens: {
      '--diffs-font-family': 'var(--font-mono)',
      '--diffs-header-font-family': 'var(--font-season)',
      '--diffs-font-size': '13px',
      '--diffs-line-height': '22px',
      '--diffs-bg-context-override': background,
      '--diffs-bg-context-gutter-override': background,
      '--diffs-bg-separator-override': 'var(--surface-3)',
      '--diffs-bg-buffer-override': 'var(--surface-3)',
      '--diffs-fg-number-override': 'var(--text-muted)',
    } as CSSProperties,
  }
}

/** Diffs sit on cards. */
export const DIFF_SURFACE = codeSurface('sim-code', 'var(--surface-2)')

/** The editor fills its pane, on the page background. */
export const EDITOR_SURFACE = codeSurface('sim-code-editor', 'var(--bg)')

/** Light or dark, following the app theme; a forced page theme wins over the user's choice. */
export function usePierreThemeType(): ThemeTypes {
  const { forcedTheme, resolvedTheme } = useTheme()
  return (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light'
}

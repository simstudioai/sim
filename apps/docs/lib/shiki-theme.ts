/**
 * Sim's syntax theme for docs code blocks. The scope mapping is shared with the app in
 * `@sim/emcn/syntax-theme`; docs supply their own palettes. Light mode
 * follows `code.css` with darker hues for readable contrast, and dark mode consumes the
 * docs semantic tokens so authored MDX and generated examples share the reading palette.
 */
import { buildSyntaxTheme, type SyntaxColors } from '@sim/emcn/syntax-theme'

/** Light-mode platform hues adjusted to meet WCAG AA text contrast on the code surface. */
const LIGHT: SyntaxColors = {
  /** `--text-primary` — the platform's base code foreground. */
  foreground: '#1a1a1a',
  /** `--surface-5` — the fill `chipFieldSurfaceClass` puts under a code surface. */
  background: '#f3f3f3',
  comment: '#15803d',
  punctuation: '#383838',
  variable: '#0e7490',
  constant: '#15803d',
  string: '#b45309',
  keyword: '#2f55ff',
  function: '#854d0e',
  regex: '#be123c',
  deleted: '#b91c1c',
}

/** Dark syntax roles resolve through the shared docs theme, including portal surfaces. */
const DARK: SyntaxColors = {
  foreground: 'var(--docs-text)',
  background: 'var(--docs-surface)',
  comment: 'var(--docs-green)',
  punctuation: 'var(--docs-text)',
  variable: 'var(--docs-blue)',
  constant: 'var(--docs-green)',
  string: 'var(--docs-orange)',
  keyword: 'var(--docs-blue)',
  function: 'var(--docs-orange)',
  regex: 'var(--docs-red)',
  deleted: 'var(--docs-red)',
}

const simShikiLight = buildSyntaxTheme('sim-light', 'light', LIGHT)
const simShikiDark = buildSyntaxTheme('sim-dark', 'dark', DARK)

/** Shared syntax palette for build-time MDX and generated API examples. */
export const simShikiOptions = {
  themes: { light: simShikiLight, dark: simShikiDark },
  defaultColor: false,
  tabindex: false,
} as const

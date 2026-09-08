import { cn } from '@sim/emcn'

/** Brand palette scoped to comparison pages and their portaled citation panels. */
export const COMPARISON_THEME = cn(
  '[--comparison-column-bg:var(--bg)] [--comparison-muted-column-bg:#F8F8F8] [--comparison-emphasis-bg:#3B3B3B]',
  'dark:[--comparison-muted-column-bg:#3B3B3B] dark:[--comparison-emphasis-bg:#525252]',
  'dark:[--bg:#1A1A1A] dark:[--surface-1:#3B3B3B] dark:[--surface-2:#1A1A1A] dark:[--surface-3:#3B3B3B]',
  'dark:[--surface-hover:#3B3B3B] dark:[--surface-active:#3B3B3B]',
  'dark:[--text-primary:#F8F8F8] dark:[--text-secondary:#E6E6E6] dark:[--text-body:#C3C3C3] dark:[--text-muted:#B4B4B4] dark:[--text-icon:#C3C3C3]'
)

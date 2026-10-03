'use client'

import { useId, useSyncExternalStore } from 'react'
import { cn } from '@sim/emcn'
import { Moon, Sun } from '@sim/emcn/icons'
import { useTheme } from 'next-themes'

/**
 * The two themes on offer, in reading order. `system` is deliberately absent:
 * the marketing site is light by design and dark is an explicit choice, so the
 * control is a plain either/or.
 */
const OPTIONS = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
] as const

type ThemeOption = (typeof OPTIONS)[number]['value']

const SEGMENT =
  'flex size-[22px] items-center justify-center rounded-full transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--text-secondary)] peer-focus-visible:outline-offset-2'

/**
 * The selected segment is painted by the theme class on `<html>`, not by React
 * state: next-themes puts that class on the document before first paint, so
 * the right segment already reads as selected in the server HTML and never
 * flips after hydration. Each segment carries both states and the `dark:` pair
 * picks one.
 */
const SEGMENT_TONE: Record<ThemeOption, string> = {
  light:
    'bg-[var(--surface-active)] text-[var(--text-primary)] dark:bg-transparent dark:text-[var(--text-muted)] dark:hover-hover:text-[var(--text-primary)]',
  dark: 'text-[var(--text-muted)] hover-hover:text-[var(--text-primary)] dark:bg-[var(--surface-active)] dark:text-[var(--text-primary)]',
}

const subscribeToNothing = () => () => {}

/**
 * `true` once hydrated, `false` in server HTML and during hydration - the
 * store-backed form React reconciles without a mismatch, unlike an effect that
 * flips state after mount.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )
}

/**
 * Footer light/dark switch: a hairline pill holding a sun and a moon, with the
 * current theme's segment filled. Picking a segment writes the visitor's
 * choice through next-themes into the marketing surface's own store
 * (`sim-landing-theme`), separate from the workspace's account-synced theme.
 *
 * Native radios provide a single tab stop and arrow-key selection. Checked
 * state waits for hydration because the server cannot read the stored theme;
 * the visual selection already follows the document theme before hydration.
 */
export function ThemeToggle() {
  const groupName = useId()
  const { resolvedTheme, setTheme } = useTheme()
  const hydrated = useHydrated()

  return (
    <div
      role='radiogroup'
      aria-label='Color theme'
      className='inline-flex items-center gap-[2px] rounded-full border border-[var(--border)] p-[2px]'
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <label key={value} className='relative cursor-pointer'>
          <input
            type='radio'
            name={groupName}
            value={value}
            aria-label={label}
            checked={hydrated && resolvedTheme === value}
            onChange={() => setTheme(value)}
            className='peer sr-only'
          />
          <span className={cn(SEGMENT, SEGMENT_TONE[value])}>
            <Icon className='size-[13px]' />
          </span>
        </label>
      ))}
    </div>
  )
}

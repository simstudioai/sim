'use client'

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { ThemeProvider, useTheme } from 'next-themes'

interface DocsThemeProviderProps {
  children: ReactNode
}

export function DocsThemeProvider({ children }: DocsThemeProviderProps) {
  return (
    <ThemeProvider
      attribute='class'
      defaultTheme='system'
      enableSystem
      storageKey='sim-docs-theme'
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}

const subscribe = () => () => {}

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
  return (
    <div
      aria-label='Color theme'
      role='group'
      className='inline-flex h-7 gap-px rounded-[20px] bg-[var(--docs-surface)] text-docs-control'
    >
      {(
        [
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ] as const
      ).map(({ value, label, icon }) => (
        <button
          key={value}
          type='button'
          onClick={() => setTheme(value)}
          aria-pressed={mounted && resolvedTheme === value}
          className={cn(
            'before:-inset-y-2 relative flex h-7 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 text-[var(--docs-segment-text)] transition-colors before:absolute before:inset-x-0 hover:bg-[var(--docs-hover)] ',
            mounted &&
              resolvedTheme === value &&
              'border-[var(--docs-segment-border)] bg-[var(--docs-segment-fill)] text-[var(--docs-heading)] shadow-[var(--docs-segment-shadow)] hover:bg-[var(--docs-segment-fill)]'
          )}
        >
          <Icon name={icon} className='size-4' />
          {label}
        </button>
      ))}
    </div>
  )
}

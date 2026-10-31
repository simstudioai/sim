'use client'

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Moon, Sun } from '@sim/emcn/icons'
import { ThemeProvider, useTheme } from 'next-themes'
import { cn } from '@/components/docs/classnames'

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
          { value: 'light', label: 'Light', icon: Sun },
          { value: 'dark', label: 'Dark', icon: Moon },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type='button'
          onClick={() => setTheme(value)}
          aria-pressed={mounted && resolvedTheme === value}
          className={cn(
            'before:-inset-y-2 relative flex h-7 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 text-[var(--docs-segment-text)] transition-colors before:absolute before:inset-x-0 hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2',
            mounted &&
              resolvedTheme === value &&
              'border-[var(--docs-segment-border)] bg-[var(--docs-segment-fill)] text-[var(--docs-heading)] shadow-[var(--docs-segment-shadow)] hover:bg-[var(--docs-segment-fill)]'
          )}
        >
          <Icon className='size-4' />
          {label}
        </button>
      ))}
    </div>
  )
}

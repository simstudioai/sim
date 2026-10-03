'use client'

import { Moon, Sun } from '@sim/emcn/icons'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type='button'
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className='flex size-[30px] cursor-pointer items-center justify-center rounded-lg text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)]'
      aria-label='Toggle theme'
    >
      <Sun className='block size-[14px] dark:hidden' />
      <Moon className='hidden size-[14px] dark:block' />
    </button>
  )
}

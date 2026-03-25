'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button className='flex cursor-pointer items-center justify-center rounded-md p-1.5 text-neutral-400'>
        <Moon className='h-4 w-4' />
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className='flex cursor-pointer items-center justify-center rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300'
      aria-label='Toggle theme'
    >
      {theme === 'dark' ? <Moon className='h-4 w-4' /> : <Sun className='h-4 w-4' />}
    </button>
  )
}

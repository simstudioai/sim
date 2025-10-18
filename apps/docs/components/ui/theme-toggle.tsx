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
      <button className='flex items-center justify-center rounded-md p-1 text-muted-foreground'>
        <Moon className='h-4 w-4' />
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className='flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground'
      aria-label='Toggle theme'
    >
      {theme === 'dark' ? <Moon className='h-4 w-4' /> : <Sun className='h-4 w-4' />}
    </button>
  )
}

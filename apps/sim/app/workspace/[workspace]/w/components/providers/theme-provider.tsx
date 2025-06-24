'use client'

import { useEffect } from 'react'
import { useGeneralStore } from '@/stores/settings/general/store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useGeneralStore((state) => state.theme)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    // If theme is system, check system preference
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.add(prefersDark ? 'dark' : 'light')
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  return children
}

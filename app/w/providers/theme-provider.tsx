'use client'

import { useEffect } from 'react'
import { useGeneralStore } from '@/stores/settings/general/store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useGeneralStore((state) => state.theme)

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
  }, [theme])

  return children
}

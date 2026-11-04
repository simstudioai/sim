'use client'

import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'
import { PlatformSurface } from '@/platform/design-system/components/platform-surface'
import type { Appearance } from '@/platform/design-system/navigation'

const ThemeContext = createContext<'light' | 'dark'>('light')
const darkQuery = '(prefers-color-scheme: dark)'
const prefersDark = () => matchMedia(darkQuery).matches
const defaultLight = () => false

function subscribe(listener: () => void) {
  const query = matchMedia(darkQuery)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

interface ProductSurfaceProps {
  preference: Appearance
  children: ReactNode
}

export function ProductSurface({ preference, children }: ProductSurfaceProps) {
  const dark = useSyncExternalStore(subscribe, prefersDark, defaultLight)
  const theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference
  return (
    <ThemeContext.Provider value={theme}>
      <PlatformSurface theme={theme}>{children}</PlatformSurface>
    </ThemeContext.Provider>
  )
}

export function usePlatformTheme() {
  return useContext(ThemeContext)
}

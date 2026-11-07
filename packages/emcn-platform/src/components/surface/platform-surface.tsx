'use client'

import { createContext, type ReactNode, useContext } from 'react'

type Appearance = 'system' | 'light' | 'dark'

const InsideSurface = createContext(false)

interface PlatformSurfaceProps {
  theme: Appearance
  embedded?: boolean
  children: ReactNode
}

/**
 * Selects the theme for the tree. A surface inside a surface adds nothing, so a view that alternates
 * with legacy chrome when embedded can wrap its parts and render plainly inside this app's own shell.
 */
export function PlatformSurface({ theme, embedded, children }: PlatformSurfaceProps) {
  const nested = useContext(InsideSurface)
  if (nested) return children
  return (
    <div data-emcn='' data-platform-ui='' data-theme={theme} data-embedded={embedded || undefined}>
      <InsideSurface.Provider value>{children}</InsideSurface.Provider>
    </div>
  )
}

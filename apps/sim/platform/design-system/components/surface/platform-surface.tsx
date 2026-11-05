'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { Appearance } from '@/platform/design-system/navigation'

const InsideSurface = createContext(false)

interface PlatformSurfaceProps {
  theme: Appearance
  children: ReactNode
}

/**
 * Selects the theme for the tree. A surface inside a surface adds nothing, so a view that alternates
 * with legacy chrome when embedded can wrap its parts and render plainly inside this app's own shell.
 */
export function PlatformSurface({ theme, children }: PlatformSurfaceProps) {
  const nested = useContext(InsideSurface)
  if (nested) return children
  return (
    <div data-platform-ui='' data-theme={theme}>
      <InsideSurface.Provider value>{children}</InsideSurface.Provider>
    </div>
  )
}

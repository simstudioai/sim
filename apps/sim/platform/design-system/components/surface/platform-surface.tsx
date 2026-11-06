'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { Appearance } from '@/platform/design-system/navigation'

const InsideSurface = createContext(false)

interface PlatformSurfaceProps {
  theme: Appearance
  systemFont?: boolean
  systemMono?: boolean
  /** Paints the canvas, for a surface that fills a region. Otherwise whatever is behind shows through. */
  canvas?: boolean
  /** Starts a surface even inside another, for a tree a portal carries out of the outer one's DOM. */
  detached?: boolean
  children: ReactNode
}

/**
 * Selects the theme for the tree. A surface inside a surface adds nothing, so a view that combines
 * with legacy chrome when embedded can wrap its parts and render plainly inside this app's root.
 */
export function PlatformSurface({
  theme,
  children,
  systemFont,
  systemMono,
  canvas,
  detached,
}: PlatformSurfaceProps) {
  const nested = useContext(InsideSurface)
  if (nested && !detached) return children
  return (
    <div
      data-platform-ui=''
      data-theme={theme}
      data-system-font={systemFont || undefined}
      data-system-mono={systemMono || undefined}
      data-canvas={canvas || undefined}
    >
      <InsideSurface.Provider value>{children}</InsideSurface.Provider>
    </div>
  )
}

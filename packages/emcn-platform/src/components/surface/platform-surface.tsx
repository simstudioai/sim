'use client'

import { createContext, type ReactNode, useContext } from 'react'

type Appearance = 'system' | 'light' | 'dark'

const InsideSurface = createContext(false)

interface PlatformSurfaceProps {
  theme: Appearance
  /** Marks a surface mounted inside the legacy host, which keeps its own focus treatment. */
  embedded?: boolean
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
  embedded,
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
      data-emcn=''
      data-platform-ui=''
      data-theme={theme}
      data-embedded={embedded || undefined}
      data-system-font={systemFont || undefined}
      data-system-mono={systemMono || undefined}
      data-canvas={canvas || undefined}
    >
      <InsideSurface.Provider value>{children}</InsideSurface.Provider>
    </div>
  )
}

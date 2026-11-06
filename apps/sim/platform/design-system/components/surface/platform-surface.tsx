import type { ReactNode } from 'react'
import type { Appearance } from '@/platform/design-system/navigation'

interface PlatformSurfaceProps {
  theme: Appearance
  systemFont?: boolean
  systemMono?: boolean
  /** Paints the canvas, for a surface that fills a region. Otherwise whatever is behind shows through. */
  canvas?: boolean
  children: ReactNode
}

export function PlatformSurface({
  theme,
  children,
  systemFont,
  systemMono,
  canvas,
}: PlatformSurfaceProps) {
  return (
    <div
      data-platform-ui=''
      data-theme={theme}
      data-system-font={systemFont || undefined}
      data-system-mono={systemMono || undefined}
      data-canvas={canvas || undefined}
    >
      {children}
    </div>
  )
}

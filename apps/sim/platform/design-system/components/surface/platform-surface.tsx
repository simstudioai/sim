import type { ReactNode } from 'react'
import type { Appearance } from '@/platform/design-system/navigation'

interface PlatformSurfaceProps {
  theme: Appearance
  children: ReactNode
}

export function PlatformSurface({ theme, children }: PlatformSurfaceProps) {
  return (
    <div data-platform-ui='' data-theme={theme}>
      {children}
    </div>
  )
}

import type { ReactNode } from 'react'

interface PlatformSurfaceProps {
  theme: 'light' | 'dark'
  children: ReactNode
}

export function PlatformSurface({ theme, children }: PlatformSurfaceProps) {
  return (
    <div data-platform-ui='' data-theme={theme}>
      {children}
    </div>
  )
}

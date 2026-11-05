import type { ReactNode } from 'react'
import type { Appearance } from '@/platform/design-system/navigation'

interface PlatformSurfaceProps {
  theme: Appearance
  systemFont?: boolean
  systemMono?: boolean
  children: ReactNode
}

export function PlatformSurface({ theme, children, systemFont, systemMono }: PlatformSurfaceProps) {
  return (
    <div
      data-platform-ui=''
      data-theme={theme}
      data-system-font={systemFont || undefined}
      data-system-mono={systemMono || undefined}
    >
      {children}
    </div>
  )
}

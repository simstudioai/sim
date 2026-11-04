'use client'

import type { ReactNode } from 'react'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'
import type { Appearance } from '@/platform/design-system/navigation'

interface PlatformSurfaceProps {
  theme: Appearance
  children: ReactNode
}

export function PlatformSurface({ theme, children }: PlatformSurfaceProps) {
  const preferences = useInterfacePreferences()
  return (
    <div
      data-platform-ui=''
      data-theme={theme}
      data-system-font={preferences?.systemFont || undefined}
      data-system-mono={preferences?.systemMono || undefined}
    >
      {children}
    </div>
  )
}

'use client'

import type { ReactNode } from 'react'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'

interface PlatformSurfaceProps {
  theme: 'light' | 'dark'
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

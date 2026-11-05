'use client'

import type { ReactNode } from 'react'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { PlatformSurface } from '@/platform/design-system/components/surface/platform-surface'
import type { Appearance } from '@/platform/design-system/navigation'

interface ProductSurfaceProps {
  preference: Appearance
  children: ReactNode
}

export function ProductSurface({ preference, children }: ProductSurfaceProps) {
  const prefs = useInterfacePreferences()
  return (
    <PlatformSurface
      theme={prefs?.appearance ?? preference}
      systemFont={prefs?.systemFont}
      systemMono={prefs?.systemMono}
    >
      {children}
    </PlatformSurface>
  )
}

'use client'

import '@/platform/design-system/styles/embedded.css'
import type { ReactNode } from 'react'
import { InterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { PlatformSurface } from '@/platform/design-system/components/surface/platform-surface'

interface RedesignChildrenProps {
  children: ReactNode
}

/**
 * Mounts the design system. `system` follows the app's theme through `<html>`'s class, in CSS, so it
 * tracks every change and is right before hydration (`lib/postcss/platform-embed.cjs`).
 *
 * Never render a legacy component inside: the surface redefines tokens legacy utilities read. Compose
 * one beside a surface within {@link RedesignSession}.
 */
export function RedesignSurface({ children }: RedesignChildrenProps) {
  return <PlatformSurface theme='system'>{children}</PlatformSurface>
}

/** The session state ported components read. Shared by every surface on a page. */
export function RedesignSession({ children }: RedesignChildrenProps) {
  return <InterfacePreferences>{children}</InterfacePreferences>
}

/** A page that is one design-system surface. */
export function RedesignHost({ children }: RedesignChildrenProps) {
  return (
    <RedesignSession>
      <RedesignSurface>{children}</RedesignSurface>
    </RedesignSession>
  )
}

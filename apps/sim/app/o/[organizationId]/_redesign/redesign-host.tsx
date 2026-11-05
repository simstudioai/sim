'use client'

import '@/platform/design-system/styles/embedded.css'
import type { ReactNode } from 'react'
import { PlatformSurface } from '@/platform/design-system/components/surface/platform-surface'

interface RedesignSurfaceProps {
  children: ReactNode
}

/**
 * Mounts the design system. `system` follows the app's theme through `<html>`'s class, in CSS, so it
 * tracks every change and is right before hydration (`lib/postcss/platform-embed.cjs`).
 *
 * Never render a legacy component inside: the surface redefines tokens legacy utilities read. Compose
 * one beside a surface instead.
 */
export function RedesignSurface({ children }: RedesignSurfaceProps) {
  return <PlatformSurface theme='system'>{children}</PlatformSurface>
}

/** Fills the app's content slot, and the grid stretches the surface so its canvas reaches the end. */
export function RedesignPageSurface({ children }: RedesignSurfaceProps) {
  return (
    <div className='grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto'>
      <RedesignSurface>{children}</RedesignSurface>
    </div>
  )
}

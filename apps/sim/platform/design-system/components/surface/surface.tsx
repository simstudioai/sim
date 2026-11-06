'use client'

import '@/platform/design-system/styles/embedded.css'
import type { ReactNode } from 'react'
import { PlatformSurface } from '@/platform/design-system/components/surface/platform-surface'

interface SurfaceProps {
  /** Paints the canvas, for a surface that fills a region. */
  canvas?: boolean
  children: ReactNode
}

/**
 * Mounts the design system. `system` follows the app's theme through `<html>`'s class, in CSS, so it
 * tracks every change and is right before hydration (`lib/postcss/platform-embed.cjs`).
 *
 * Never render a legacy component inside: the surface redefines tokens legacy utilities read. Compose
 * one beside a surface instead.
 */
export function Surface({ canvas, children }: SurfaceProps) {
  return (
    <PlatformSurface theme='system' canvas={canvas}>
      {children}
    </PlatformSurface>
  )
}

/**
 * Fills the app's content slot, and the grid stretches the surface so its canvas reaches the end.
 *
 * The host's Tailwind does not scan `platform/`, so these utilities exist only while a scanned file
 * also names them (`grid-cols-[minmax(0,1fr)]`: `settings-frame.tsx`).
 */
export function PageSurface({ children }: { children: ReactNode }) {
  return (
    <div className='grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto'>
      <Surface canvas>{children}</Surface>
    </div>
  )
}

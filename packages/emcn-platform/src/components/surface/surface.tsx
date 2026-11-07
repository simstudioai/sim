'use client'

import '#platform/styles/platform.css'
import type { ReactNode } from 'react'
import { PlatformSurface } from '#platform/components/surface/platform-surface'
import styles from '#platform/components/surface/surface.module.css'

interface SurfaceProps {
  /** Paints the canvas, for a surface that fills a region. */
  canvas?: boolean
  /** For a tree portalled out of its parent surface, whose context still says it is inside one. */
  detached?: boolean
  children: ReactNode
}

/**
 * Mounts the design system. `system` follows the app's theme through `<html>`'s class, in CSS, so it
 * tracks every change and is right before hydration (`lib/postcss/platform-embed.cjs`).
 *
 * Never render a legacy component inside: the surface redefines tokens legacy utilities read. Compose
 * one beside a surface instead.
 */
export function Surface({ canvas, detached, children }: SurfaceProps) {
  return (
    <PlatformSurface theme='system' embedded canvas={canvas} detached={detached}>
      {children}
    </PlatformSurface>
  )
}

/** Fills the app's content slot, and the grid stretches the surface so its canvas reaches the end. */
export function PageSurface({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <Surface canvas>{children}</Surface>
    </div>
  )
}

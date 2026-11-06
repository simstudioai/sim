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

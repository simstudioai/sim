'use client'

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface BesideSurfaceProps {
  children: ReactNode
}

/**
 * Mounts a legacy credential dialog on `document.body`, outside `[data-platform-ui]`, so the
 * surface's tokens never reach it. It is only reached after a viewer action, never on the server.
 */
export function BesideSurface({ children }: BesideSurfaceProps) {
  return createPortal(children, document.body)
}

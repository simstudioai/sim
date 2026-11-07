'use client'

import { type HTMLAttributes, useState } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { PortalContainerProvider } from '@sim/emcn-legacy'
import styles from '@/components/workflow-preview/canvas.module.css'

interface CanvasProps extends HTMLAttributes<HTMLDivElement> {}

/** Scopes the legacy renderer and its overlays to the documentation preview. */
export function Canvas({ className, children, ...props }: CanvasProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setContainer} className={cn(styles.canvas, className)} {...props}>
      <PortalContainerProvider container={container}>{children}</PortalContainerProvider>
    </div>
  )
}

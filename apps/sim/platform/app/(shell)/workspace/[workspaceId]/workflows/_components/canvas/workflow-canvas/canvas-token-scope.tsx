'use client'

import { type ReactNode, useRef } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import scopeStyles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-canvas/canvas-token-scope.module.css'
import tokens from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-canvas/canvas-tokens.module.css'
import { usePlatformColorMode } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-canvas/use-platform-color-mode'
import { season } from '@/platform/lib/data/workflows'

type CanvasColorMode = ReturnType<typeof usePlatformColorMode>

interface CanvasTokenScopeProps {
  /** Renders the canvas surface; receives the color mode for React Flow's `colorMode`. */
  children: (colorMode: CanvasColorMode) => ReactNode
}

/**
 * The legacy canvas document for a canvas surface rendered outside the editor canvas, such as the
 * read-only workflow preview: the canvas tokens in the Platform theme's color mode, the legacy
 * document face and the text base the blocks inherit. It adds no box of its own, so the surface
 * inside sizes itself against its real parent.
 */
export function CanvasTokenScope({ children }: CanvasTokenScopeProps) {
  const scopeRef = useRef<HTMLDivElement>(null)
  const colorMode = usePlatformColorMode(scopeRef)

  return (
    <div
      ref={scopeRef}
      className={cn(tokens.tokens, season.variable, scopeStyles.scope)}
      data-color-mode={colorMode}
    >
      {children(colorMode)}
    </div>
  )
}

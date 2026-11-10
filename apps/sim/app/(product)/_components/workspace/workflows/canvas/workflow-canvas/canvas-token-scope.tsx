'use client'

import { type ReactNode, useRef } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import scopeStyles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/canvas-token-scope.module.css'
import tokens from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/canvas-tokens.module.css'
import { usePlatformColorMode } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/use-platform-color-mode'
import { season } from '@/platform/lib/data/workflows'

/** The code-highlight tokens, for a canvas surface that renders outside this scope, such as a portaled card. */
export const CANVAS_CODE_TOKENS_CLASS = tokens.codeTokens

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

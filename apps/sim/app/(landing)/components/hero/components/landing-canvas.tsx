'use client'

import React from 'react'
import { ReactFlowProvider } from 'reactflow'
import { DotPattern } from './dot-pattern'
import { LandingFlow } from './landing-flow'
import type { LandingCanvasProps } from './types'

/**
 * Main landing canvas component that provides the container and background
 * for the React Flow visualization
 * @param props - Component properties including nodes, edges, and viewport control
 * @returns A canvas component with dot pattern background and React Flow content
 */
export function LandingCanvas({
  nodes,
  edges,
  groupBox,
  worldWidth,
  viewportApiRef,
}: LandingCanvasProps) {
  const flowWrapRef = React.useRef<HTMLDivElement | null>(null)

  return (
    <div className='relative mx-auto flex h-[36rem] w-full max-w-[1250px] overflow-hidden rounded-t-[10px] bg-background/80 shadow-sm'>
      <DotPattern className='pointer-events-none absolute top-0 left-0 z-0 h-full w-full opacity-20' />
      <div ref={flowWrapRef} className='relative z-10 h-full w-full'>
        <ReactFlowProvider>
          <LandingFlow
            nodes={nodes}
            edges={edges}
            groupBox={groupBox}
            worldWidth={worldWidth}
            wrapperRef={flowWrapRef}
            viewportApiRef={viewportApiRef}
          />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

export { CARD_HEIGHT, CARD_WIDTH } from './constants'
// Re-export types and constants for convenience
export type {
  LandingBlockNode,
  LandingEdgeData,
  LandingGroupData,
  LandingManualBlock,
  LandingViewportApi,
} from './types'

'use client'

import React from 'react'
import type { Edge, Node } from 'reactflow'
import { ReactFlowProvider } from 'reactflow'
import { DotPattern } from './dot-pattern'
import type { LandingCardData } from './landing-block/landing-block'
import { LandingFlow } from './landing-flow'

/**
 * Visual constants for landing node dimensions
 */
export const CARD_WIDTH = 256
export const CARD_HEIGHT = 92

/**
 * Landing block node with positioning information
 */
export interface LandingBlockNode extends LandingCardData {
  /** Unique identifier for the node */
  id: string
  /** X coordinate position */
  x: number
  /** Y coordinate position */
  y: number
}

/**
 * Data structure for edges connecting nodes
 */
export interface LandingEdgeData {
  /** Unique identifier for the edge */
  id: string
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
}

/**
 * Data structure for grouping visual elements
 */
export interface LandingGroupData {
  /** X coordinate of the group */
  x: number
  /** Y coordinate of the group */
  y: number
  /** Width of the group */
  w: number
  /** Height of the group */
  h: number
  /** Labels associated with the group */
  labels: string[]
}

/**
 * Manual block with responsive positioning
 */
export interface LandingManualBlock extends Omit<LandingCardData, 'x' | 'y'> {
  /** Unique identifier */
  id: string
  /** Responsive position configurations */
  positions: {
    /** Position for mobile devices */
    mobile: { x: number; y: number }
    /** Position for tablet devices */
    tablet: { x: number; y: number }
    /** Position for desktop devices */
    desktop: { x: number; y: number }
  }
}

/**
 * Public API for controlling the viewport
 */
export interface LandingViewportApi {
  /**
   * Pan the viewport to specific coordinates
   * @param x - X coordinate to pan to
   * @param y - Y coordinate to pan to
   * @param options - Optional configuration for the pan animation
   */
  panTo: (x: number, y: number, options?: { duration?: number }) => void
  /**
   * Get the current viewport state
   * @returns Current viewport position and zoom level
   */
  getViewport: () => { x: number; y: number; zoom: number }
}

/**
 * Props for the LandingCanvas component
 */
export interface LandingCanvasProps {
  /** Array of nodes to render */
  nodes: Node[]
  /** Array of edges connecting nodes */
  edges: Edge[]
  /** Optional group box for visual grouping */
  groupBox: LandingGroupData | null
  /** Total width of the world/canvas */
  worldWidth: number
  /** Ref to expose viewport control API */
  viewportApiRef: React.MutableRefObject<LandingViewportApi | null>
}

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
    <div className='relative mx-auto flex h-[612px] w-full max-w-[1285px] border-none bg-background/80'>
      <DotPattern className='pointer-events-none absolute inset-0 z-0 h-full w-full opacity-20' />

      {/* Use template button overlay */}
      {/* <button
        type='button'
        aria-label='Use template'
        className='absolute top-[24px] left-[50px] z-20 inline-flex items-center justify-center rounded-[10px] border border-[#343434] bg-gradient-to-b from-[#060606] to-[#323232] px-3 py-1.5 text-sm text-white shadow-[inset_0_1.25px_2.5px_0_#9B77FF] transition-all duration-200'
        onClick={() => {
          // Template usage logic will be implemented here
        }}
      >
        Use template
      </button> */}

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

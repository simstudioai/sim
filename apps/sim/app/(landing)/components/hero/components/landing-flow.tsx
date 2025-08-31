'use client'

import React from 'react'
import ReactFlow, { useReactFlow } from 'reactflow'
import 'reactflow/dist/style.css'
import { CARD_WIDTH, type LandingCanvasProps } from './landing-canvas'
import { LandingEdge } from './landing-edge'
import { LandingLoopNode } from './landing-loop-node'
import { LandingNode } from './landing-node'

/**
 * Props for the LandingFlow component
 */
export interface LandingFlowProps extends LandingCanvasProps {
  /** Reference to the wrapper element */
  wrapperRef: React.RefObject<HTMLDivElement | null>
}

/**
 * React Flow wrapper component for the landing canvas
 * Handles viewport control, auto-panning, and node/edge rendering
 * @param props - Component properties including nodes, edges, and viewport control
 * @returns A configured React Flow instance
 */
export function LandingFlow({
  nodes,
  edges,
  groupBox,
  worldWidth,
  wrapperRef,
  viewportApiRef,
}: LandingFlowProps) {
  const { setViewport, getViewport } = useReactFlow()
  const [rfReady, setRfReady] = React.useState(false)

  // Node and edge types map
  const nodeTypes = React.useMemo(
    () => ({
      landing: LandingNode,
      landingLoop: LandingLoopNode,
    }),
    []
  )
  const edgeTypes = React.useMemo(() => ({ landingEdge: LandingEdge }), [])

  // Compose nodes with optional group overlay
  const flowNodes = nodes

  // Auto-pan to the right only if content overflows the wrapper
  React.useEffect(() => {
    const el = wrapperRef.current as HTMLDivElement | null
    if (!el || !rfReady || nodes.length === 0) return

    const containerWidth = el.clientWidth
    // Derive overflow from actual node positions for accuracy
    const PAD = 16
    const maxRight = nodes.reduce((m, n) => Math.max(m, (n.position?.x ?? 0) + CARD_WIDTH), 0)
    const contentWidth = Math.max(worldWidth, maxRight + PAD)
    const overflow = Math.max(0, contentWidth - containerWidth)

    // Delay pan so initial nodes are visible briefly
    const timer = window.setTimeout(() => {
      if (overflow > 12) {
        setViewport({ x: -overflow, y: 0, zoom: 1 }, { duration: 900 })
      }
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [worldWidth, wrapperRef, setViewport, rfReady, nodes])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: 'smoothstep' }}
      elementsSelectable={false}
      nodesDraggable={false}
      nodesConnectable={false}
      zoomOnScroll={false}
      panOnScroll={false}
      zoomOnPinch={false}
      panOnDrag={false}
      proOptions={{ hideAttribution: true }}
      fitView={false}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      onInit={(instance) => {
        setRfReady(true)
        // Expose limited viewport API for outer timeline to pan smoothly
        viewportApiRef.current = {
          panTo: (x: number, y: number, options?: { duration?: number }) => {
            setViewport({ x, y, zoom: 1 }, { duration: options?.duration ?? 0 })
          },
          getViewport: () => getViewport(),
        }
      }}
      className='pointer-events-none h-full w-full'
    >
      {null}
    </ReactFlow>
  )
}

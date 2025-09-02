'use client'

import React from 'react'
import ReactFlow, { applyNodeChanges, type NodeChange, useReactFlow } from 'reactflow'
import 'reactflow/dist/style.css'
import { LandingLoopNode } from './landing-block/landing-loop-node'
import { LandingNode } from './landing-block/landing-node'
import { CARD_WIDTH, type LandingCanvasProps } from './landing-canvas'
import { LandingEdge } from './landing-edge/landing-edge'

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
  const [localNodes, setLocalNodes] = React.useState(nodes)

  // Update local nodes when props change
  React.useEffect(() => {
    setLocalNodes(nodes)
  }, [nodes])

  // Handle node changes (dragging)
  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    setLocalNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  // Node and edge types map
  const nodeTypes = React.useMemo(
    () => ({
      landing: LandingNode,
      landingLoop: LandingLoopNode,
      group: LandingLoopNode, // Use our custom loop node for group type
    }),
    []
  )
  const edgeTypes = React.useMemo(() => ({ landingEdge: LandingEdge }), [])

  // Compose nodes with optional group overlay
  const flowNodes = localNodes

  // Auto-pan to the right only if content overflows the wrapper
  React.useEffect(() => {
    const el = wrapperRef.current as HTMLDivElement | null
    if (!el || !rfReady || localNodes.length === 0) return

    const containerWidth = el.clientWidth
    // Derive overflow from actual node positions for accuracy
    const PAD = 16
    const maxRight = localNodes.reduce((m, n) => Math.max(m, (n.position?.x ?? 0) + CARD_WIDTH), 0)
    const contentWidth = Math.max(worldWidth, maxRight + PAD)
    const overflow = Math.max(0, contentWidth - containerWidth)

    // Delay pan so initial nodes are visible briefly
    const timer = window.setTimeout(() => {
      if (overflow > 12) {
        setViewport({ x: -overflow, y: 0, zoom: 1 }, { duration: 900 })
      }
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [worldWidth, wrapperRef, setViewport, rfReady, localNodes])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: 'smoothstep' }}
      elementsSelectable={true}
      selectNodesOnDrag={false}
      nodesDraggable={true}
      nodesConnectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnScroll={false}
      zoomOnPinch={false}
      panOnDrag={false}
      draggable={false}
      preventScrolling={false}
      autoPanOnNodeDrag={false}
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
      className='h-full w-full'
      style={{
        // Override React Flow's default cursor styles
        cursor: 'default',
      }}
    >
      <style>
        {`
          /* Force default cursor on the canvas/pane */
          .react-flow__pane {
            cursor: default !important;
          }
          
          /* Force grab cursor on nodes */
          .react-flow__node {
            cursor: grab !important;
          }
          
          /* Force grabbing cursor when dragging nodes */
          .react-flow__node.dragging {
            cursor: grabbing !important;
          }
          
          /* Ensure viewport also has default cursor */
          .react-flow__viewport {
            cursor: default !important;
          }
        `}
      </style>
      {null}
    </ReactFlow>
  )
}

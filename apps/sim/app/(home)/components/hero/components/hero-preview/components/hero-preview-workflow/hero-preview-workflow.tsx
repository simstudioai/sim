'use client'

import { useCallback, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import ReactFlow, {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  getSmoothStepPath,
  type Node,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { PreviewBlockNode } from '@/app/(home)/components/hero/components/hero-preview/components/hero-preview-workflow/preview-block-node'
import {
  EASE_OUT,
  type PreviewWorkflow,
  toReactFlowElements,
} from '@/app/(home)/components/hero/components/hero-preview/components/hero-preview-workflow/workflow-data'

interface HeroPreviewWorkflowProps {
  workflow: PreviewWorkflow
  animate?: boolean
}

/**
 * Custom edge that draws left-to-right on initial load via stroke animation.
 * Falls back to a static path when `data.animate` is false.
 */
function PreviewEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  if (data?.animate) {
    return (
      <motion.path
        id={id}
        className='react-flow__edge-path'
        d={edgePath}
        style={{ ...style, fill: 'none' }}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: { duration: 0.4, delay: data.delay ?? 0, ease: EASE_OUT },
          opacity: { duration: 0.15, delay: data.delay ?? 0 },
        }}
      />
    )
  }

  return (
    <path
      id={id}
      className='react-flow__edge-path'
      d={edgePath}
      style={{ ...style, fill: 'none' }}
    />
  )
}

const NODE_TYPES: NodeTypes = { previewBlock: PreviewBlockNode }
const EDGE_TYPES: EdgeTypes = { previewEdge: PreviewEdge }
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1 } as const

/**
 * Inner flow component. Keyed on workflow ID by the parent so it remounts
 * cleanly on workflow switch — fitView fires on mount with zero delay.
 */
function PreviewFlow({ workflow, animate = false }: HeroPreviewWorkflowProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => toReactFlowElements(workflow, animate),
    [workflow, animate]
  )

  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      defaultEdgeOptions={{ type: 'previewEdge' }}
      elementsSelectable={false}
      nodesDraggable
      nodesConnectable={false}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnScroll={false}
      zoomOnPinch={false}
      panOnDrag
      preventScrolling={false}
      autoPanOnNodeDrag={false}
      proOptions={PRO_OPTIONS}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      className='h-full w-full bg-[#1b1b1b]'
    />
  )
}

/**
 * Lightweight ReactFlow canvas displaying an interactive workflow preview.
 * The key on workflow.id forces a clean remount on switch — instant fitView,
 * no timers, no flicker.
 */
export function HeroPreviewWorkflow({ workflow, animate = false }: HeroPreviewWorkflowProps) {
  return (
    <div className='h-full w-full'>
      <ReactFlowProvider key={workflow.id}>
        <PreviewFlow workflow={workflow} animate={animate} />
      </ReactFlowProvider>
    </div>
  )
}

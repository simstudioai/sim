'use client'

import { useCallback, useMemo, useState } from 'react'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import ReactFlow, {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
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
import { PreviewBlockNode } from '@/components/workflow-preview/preview-block-node'
import {
  EASE_OUT,
  type PreviewWorkflow,
  toReactFlowElements,
} from '@/components/workflow-preview/workflow-data'

interface WorkflowPreviewProps {
  workflow: PreviewWorkflow
  /** Canvas height in px. Default 260. */
  height?: number
  animate?: boolean
  /** Emphasize one block by id, dimming the rest. */
  highlightBlock?: string
  /** Emphasize one edge by id, dimming the rest. */
  highlightEdge?: string
}

/** Smooth-step edge, matching the app's connection styling. */
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
      <m.path
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
const FIT_VIEW_OPTIONS = { padding: 0.25, maxZoom: 1 } as const

function PreviewFlow({
  workflow,
  animate = false,
  highlightBlock,
  highlightEdge,
}: WorkflowPreviewProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => toReactFlowElements(workflow, animate, { highlightBlock, highlightEdge }),
    [workflow, animate, highlightBlock, highlightEdge]
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
      minZoom={0.4}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      className='h-full w-full'
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color='#2a2a2a' />
    </ReactFlow>
  )
}

/**
 * Read-only, app-styled workflow diagram for docs pages. Renders a
 * {@link PreviewWorkflow} with ReactFlow — draggable, non-editable, no app runtime.
 *
 * @example
 * <WorkflowPreview workflow={CLASSIFY_WORKFLOW} />
 */
export function WorkflowPreview({
  workflow,
  height = 260,
  animate = false,
  highlightBlock,
  highlightEdge,
}: WorkflowPreviewProps) {
  return (
    <LazyMotion features={domAnimation}>
      <div
        className='not-prose my-6 overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#0f0f0f]'
        style={{ height }}
      >
        <ReactFlowProvider key={`${workflow.id}-${highlightBlock ?? ''}-${highlightEdge ?? ''}`}>
          <PreviewFlow
            workflow={workflow}
            animate={animate}
            highlightBlock={highlightBlock}
            highlightEdge={highlightEdge}
          />
        </ReactFlowProvider>
      </div>
    </LazyMotion>
  )
}

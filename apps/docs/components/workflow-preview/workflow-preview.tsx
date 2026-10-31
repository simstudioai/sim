'use client'

import { useCallback, useId, useMemo, useState } from 'react'
import { Expand } from '@sim/emcn/icons'
import { CANVAS_Z_INDEX_MODE, useCanvasColorMode } from '@sim/workflow-renderer'
import {
  applyNodeChanges,
  type EdgeProps,
  type EdgeTypes,
  getSmoothStepPath,
  type NodeTypes,
  type OnNodesChange,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import { domAnimation, LazyMotion, m, useReducedMotion } from 'framer-motion'
import '@xyflow/react/dist/style.css'
import { DocsButton } from '@/components/docs/primitives'
import { Lightbox } from '@/components/ui/lightbox'
import { DocsBlockNode } from '@/components/workflow-preview/docs-block-node'
import { DocsContainerNode } from '@/components/workflow-preview/docs-container-node'
import { FitViewAfterInit } from '@/components/workflow-preview/fit-view-after-init'
import { PreviewSelectionContext } from '@/components/workflow-preview/preview-selection-context'
import {
  EASE_OUT,
  type PreviewFlowEdge,
  type PreviewNode,
  type PreviewWorkflow,
  toReactFlowElements,
} from '@/components/workflow-preview/workflow-data'

export interface WorkflowPreviewProps {
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
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<PreviewFlowEdge>) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset: 30,
  })

  if (data?.animate) {
    return (
      <m.path
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

  return <path className='react-flow__edge-path' d={edgePath} style={{ ...style, fill: 'none' }} />
}

const NODE_TYPES = {
  previewBlock: DocsBlockNode,
  previewContainer: DocsContainerNode,
} satisfies NodeTypes
const EDGE_TYPES = { previewEdge: PreviewEdge } satisfies EdgeTypes
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.25 } as const
const LIGHTBOX_FIT_VIEW_OPTIONS = { padding: 0.3 } as const

function PreviewFlow({
  workflow,
  animate = false,
  highlightBlock,
  highlightEdge,
  interactive = false,
  onNodeClick,
  onPaneClick,
}: WorkflowPreviewProps & {
  interactive?: boolean
  onNodeClick?: (blockId: string) => void
  onPaneClick?: () => void
}) {
  const flowId = useId()
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => toReactFlowElements(workflow, animate, { highlightBlock, highlightEdge }),
    [workflow, animate, highlightBlock, highlightEdge]
  )

  const colorMode = useCanvasColorMode()

  const [nodeState, setNodeState] = useState<PreviewNode[]>(initialNodes)

  const nodes = useMemo(() => {
    const nodesById = new Map(nodeState.map((node) => [node.id, node]))
    return initialNodes.map((node) => {
      const stored = nodesById.get(node.id)
      return stored ? { ...stored, ...node, position: stored.position } : node
    })
  }, [initialNodes, nodeState])

  const onNodesChange: OnNodesChange<PreviewNode> = useCallback(
    (changes) => setNodeState((current) => applyNodeChanges(changes, current)),
    []
  )

  return (
    <ReactFlowProvider initialNodes={nodes} initialEdges={initialEdges}>
      <PreviewSelectionContext value={onNodeClick}>
        <ReactFlow<PreviewNode, PreviewFlowEdge>
          id={flowId}
          colorMode={colorMode}
          zIndexMode={CANVAS_Z_INDEX_MODE}
          nodes={nodes}
          edges={initialEdges}
          onNodesChange={onNodesChange}
          onPaneClick={onPaneClick}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={{ type: 'previewEdge' }}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          nodesDraggable
          nodesConnectable={false}
          zoomOnScroll={interactive}
          zoomOnDoubleClick={interactive}
          panOnScroll={false}
          zoomOnPinch
          panOnDrag
          preventScrolling={interactive}
          autoPanOnNodeDrag={false}
          proOptions={PRO_OPTIONS}
          minZoom={0.1}
          className='size-full [--text-muted:var(--text-secondary)]! [--xy-background-color:var(--bg)]'
        >
          <FitViewAfterInit options={interactive ? LIGHTBOX_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS} />
        </ReactFlow>
      </PreviewSelectionContext>
    </ReactFlowProvider>
  )
}

/**
 * Read-only, app-styled workflow diagram for docs pages. Renders a
 * {@link PreviewWorkflow} with ReactFlow — draggable, non-editable, no app
 * runtime. Clicking a block (or the expand control) opens a full-screen
 * lightbox with zoom and pan.
 *
 * @example
 * <WorkflowPreview workflow={CLASSIFY_WORKFLOW} />
 */
export function WorkflowPreview({
  workflow,
  height = 340,
  animate = false,
  highlightBlock,
  highlightEdge,
}: WorkflowPreviewProps) {
  const reducedMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)

  return (
    <LazyMotion features={domAnimation}>
      <div
        className='not-prose relative my-7 flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--docs-border)] bg-[var(--docs-canvas)]'
        style={{ height }}
      >
        <div className='flex h-11 shrink-0 items-center justify-between gap-3 border-[var(--docs-border)] border-b px-4'>
          <span className='min-w-0 text-docs-control'>{workflow.name}</span>
          <Lightbox
            open={expanded}
            onOpenChange={setExpanded}
            title={workflow.name}
            description='Interactive workflow preview. Drag to pan or move blocks, and scroll to zoom. Press Escape to close.'
            trigger={
              <DocsButton aria-label={`Inspect workflow: ${workflow.name}`}>
                <Expand className='size-4' />
                Inspect workflow
              </DocsButton>
            }
          >
            <div className='relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-[var(--docs-canvas)]'>
              <PreviewFlow
                key={`${workflow.id}-lightbox`}
                workflow={workflow}
                highlightBlock={highlightBlock}
                highlightEdge={highlightEdge}
                interactive
              />
            </div>
          </Lightbox>
        </div>
        <div className='min-h-0 min-w-0 flex-1'>
          <PreviewFlow
            key={`${workflow.id}-${highlightBlock ?? ''}-${highlightEdge ?? ''}`}
            workflow={workflow}
            animate={animate && !reducedMotion}
            highlightBlock={highlightBlock}
            highlightEdge={highlightEdge}
            onNodeClick={() => setExpanded(true)}
            onPaneClick={() => setExpanded(true)}
          />
        </div>
      </div>
    </LazyMotion>
  )
}

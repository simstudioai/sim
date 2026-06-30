'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
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
import { BlockInspector } from '@/components/workflow-preview/block-inspector'
import { DocsBlockNode } from '@/components/workflow-preview/docs-block-node'
import { DocsContainerNode } from '@/components/workflow-preview/docs-container-node'
import {
  EASE_OUT,
  type PreviewBlock,
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

const NODE_TYPES: NodeTypes = {
  previewBlock: DocsBlockNode,
  previewContainer: DocsContainerNode,
}
const EDGE_TYPES: EdgeTypes = { previewEdge: PreviewEdge }
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.25, maxZoom: 1 } as const
const LIGHTBOX_FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 1.4 } as const

/** Field titles rendered as multiline text in the inspector. */
const TEXTAREA_TITLES = new Set(['Messages', 'Prompt', 'Code', 'Data', 'Body', 'Display'])
/** Field titles rendered as dropdowns in the inspector. */
const SELECT_TITLES = new Set([
  'Model',
  'Operation',
  'Method',
  'Unit',
  'Event type',
  'Validation',
  'Account',
  'Table',
  'Knowledge Base',
  'Language',
  'Workflow',
  'Format',
])

function inspectorFieldsFor(block: PreviewBlock) {
  const rowFields = block.rows.map((row) => ({
    label: row.title,
    kind:
      TEXTAREA_TITLES.has(row.title) || row.value.length > 40
        ? ('textarea' as const)
        : SELECT_TITLES.has(row.title)
          ? ('select' as const)
          : ('input' as const),
    value: row.value,
  }))
  const branchFields = (block.branches ?? []).map((branch) => ({
    label: branch.label,
    kind: 'code' as const,
    value: branch.value,
    placeholder: '—',
  }))
  return [...rowFields, ...branchFields]
}

function PreviewFlow({
  workflow,
  animate = false,
  highlightBlock,
  highlightEdge,
  selectedBlock,
  interactive = false,
  onNodeClick,
}: WorkflowPreviewProps & {
  selectedBlock?: string
  interactive?: boolean
  onNodeClick?: (blockId: string) => void
}) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => toReactFlowElements(workflow, animate, { highlightBlock, highlightEdge, selectedBlock }),
    [workflow, animate, highlightBlock, highlightEdge, selectedBlock]
  )

  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges])

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
      onNodeClick={onNodeClick ? (_, node) => onNodeClick(node.id) : undefined}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      defaultEdgeOptions={{ type: 'previewEdge' }}
      elementsSelectable={false}
      nodesDraggable
      nodesConnectable={false}
      zoomOnScroll={interactive}
      zoomOnDoubleClick={interactive}
      panOnScroll={false}
      zoomOnPinch={interactive}
      panOnDrag
      preventScrolling={interactive}
      autoPanOnNodeDrag={false}
      proOptions={PRO_OPTIONS}
      minZoom={0.2}
      fitView
      fitViewOptions={interactive ? LIGHTBOX_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS}
      className='h-full w-full'
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color='var(--border)' />
    </ReactFlow>
  )
}

/**
 * Read-only, app-styled workflow diagram for docs pages. Renders a
 * {@link PreviewWorkflow} with ReactFlow — draggable, non-editable, no app
 * runtime. Clicking a block (or the expand control) opens a full-screen
 * lightbox with zoom and pan, plus a read-only inspector panel showing the
 * selected block's full configuration — canvas rows truncate, the inspector
 * doesn't.
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
  const [expanded, setExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [expanded])

  const selectedBlock = selectedId
    ? (workflow.blocks.find((b) => b.id === selectedId) ?? null)
    : null

  const openWith = (blockId: string | null) => {
    setSelectedId(blockId)
    setExpanded(true)
  }

  return (
    <LazyMotion features={domAnimation}>
      <div
        className='not-prose group relative my-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]'
        style={{ height }}
      >
        <ReactFlowProvider key={`${workflow.id}-${highlightBlock ?? ''}-${highlightEdge ?? ''}`}>
          <PreviewFlow
            workflow={workflow}
            animate={animate}
            highlightBlock={highlightBlock}
            highlightEdge={highlightEdge}
            onNodeClick={(id) => openWith(id)}
          />
        </ReactFlowProvider>
        <button
          type='button'
          aria-label='Expand workflow preview'
          onClick={() => openWith(null)}
          className='absolute top-2 right-2 z-10 flex size-[28px] items-center justify-center rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-4)] text-[var(--text-muted)] opacity-0 transition-opacity duration-150 hover:text-[var(--text-primary)] group-hover:opacity-100'
        >
          <Maximize2 className='size-[13px]' />
        </button>
      </div>

      {expanded && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm'
          onClick={() => setExpanded(false)}
          onKeyDown={() => {}}
          role='presentation'
        >
          <div
            className='relative flex h-[86vh] w-[92vw] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]'
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
            role='presentation'
          >
            <div className='relative min-w-0 flex-1'>
              <div className='pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-4 py-3'>
                <span className='text-[13px] text-[var(--text-muted)]'>{workflow.name}</span>
                <button
                  type='button'
                  aria-label='Close'
                  onClick={() => setExpanded(false)}
                  className='pointer-events-auto flex size-[28px] items-center justify-center rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-4)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]'
                >
                  <X className='size-[14px]' />
                </button>
              </div>
              <ReactFlowProvider key={`${workflow.id}-lightbox`}>
                <PreviewFlow
                  workflow={workflow}
                  highlightBlock={highlightBlock}
                  highlightEdge={highlightEdge}
                  selectedBlock={selectedId ?? undefined}
                  interactive
                  onNodeClick={(id) => setSelectedId(id)}
                />
              </ReactFlowProvider>
            </div>

            <div className='w-[340px] flex-shrink-0 border-[var(--border)] border-l'>
              {selectedBlock ? (
                <BlockInspector
                  embedded
                  name={selectedBlock.name}
                  type={selectedBlock.type}
                  color={selectedBlock.bgColor}
                  fields={inspectorFieldsFor(selectedBlock)}
                  tools={selectedBlock.tools}
                />
              ) : (
                <div className='flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--text-muted)]'>
                  Select a block to see its full configuration
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </LazyMotion>
  )
}

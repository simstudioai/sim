'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { Expand, X } from '@sim/emcn/icons'
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
import { domAnimation, LazyMotion, m } from 'framer-motion'
import '@xyflow/react/dist/style.css'
import { BLOCK_DISPLAY_WORKFLOWS } from '@/components/workflow-preview/block-display-workflows'
import { BlockInspector } from '@/components/workflow-preview/block-inspector'
import { DocsBlockNode } from '@/components/workflow-preview/docs-block-node'
import { DocsContainerNode } from '@/components/workflow-preview/docs-container-node'
import { FitViewAfterInit } from '@/components/workflow-preview/fit-view-after-init'
import { PreviewSelectionContext } from '@/components/workflow-preview/preview-selection-context'
import {
  EASE_OUT,
  type PreviewBlock,
  type PreviewFlowEdge,
  type PreviewNode,
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

const NODE_TYPES = {
  previewBlock: DocsBlockNode,
  previewContainer: DocsContainerNode,
} satisfies NodeTypes
const EDGE_TYPES = { previewEdge: PreviewEdge } satisfies EdgeTypes
const PRO_OPTIONS = { hideAttribution: true }
const FIT_VIEW_OPTIONS = { padding: 0.25 } as const
const LIGHTBOX_FIT_VIEW_OPTIONS = { padding: 0.3 } as const

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
  // Show the block type's full field list (from the reference data) with this
  // block's example values overlaid, so the inspector reads like the editor's
  // panel — every field — not just the summary rows shown on the canvas node.
  // Apply the template only when the block authored rows that are actually a
  // subset of it; otherwise the type string is ambiguous (a `table` action vs
  // the table trigger, a `webhook` trigger vs the webhook action) and the wrong
  // template would win, so the block's own authored rows are the source of
  // truth. A block with no rows (e.g. a router defined only by its branches)
  // keeps its empty set rather than inheriting the template's invented defaults.
  const exampleByTitle = new Map(block.rows.map((row) => [row.title, row.value]))
  const template = BLOCK_DISPLAY_WORKFLOWS[block.type]?.blocks[0]?.rows
  const fullRows =
    template &&
    block.rows.length > 0 &&
    block.rows.every((row) => template.some((field) => field.title === row.title))
      ? template
      : block.rows
  const rowFields = fullRows.map((row) => {
    const value = exampleByTitle.get(row.title) ?? row.value
    return {
      label: row.title,
      kind:
        TEXTAREA_TITLES.has(row.title) || value.length > 40
          ? ('textarea' as const)
          : SELECT_TITLES.has(row.title)
            ? ('select' as const)
            : ('input' as const),
      value,
    }
  })
  const branchFields = (block.branches ?? []).map((branch) => ({
    label: branch.label,
    kind: 'code' as const,
    // Match the canvas + the editor's getDisplayValue: a blank value reads as '-'.
    value: branch.value || '-',
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
  onPaneClick,
}: WorkflowPreviewProps & {
  selectedBlock?: string
  interactive?: boolean
  onNodeClick?: (blockId: string) => void
  onPaneClick?: () => void
}) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => toReactFlowElements(workflow, animate, { highlightBlock, highlightEdge, selectedBlock }),
    [workflow, animate, highlightBlock, highlightEdge, selectedBlock]
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
    <PreviewSelectionContext value={onNodeClick}>
      <ReactFlow<PreviewNode, PreviewFlowEdge>
        colorMode={colorMode}
        zIndexMode={CANVAS_Z_INDEX_MODE}
        nodes={nodes}
        edges={initialEdges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick ? (_, node) => onNodeClick(node.id) : undefined}
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
        className='h-full w-full [--text-muted:var(--text-secondary)]! [--xy-background-color:var(--bg)]'
      >
        <FitViewAfterInit options={interactive ? LIGHTBOX_FIT_VIEW_OPTIONS : FIT_VIEW_OPTIONS} />
      </ReactFlow>
    </PreviewSelectionContext>
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
  height = 340,
  animate = false,
  highlightBlock,
  highlightEdge,
}: WorkflowPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!expanded) {
      dialog.close()
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    closeButtonRef.current?.focus()
    return () => {
      dialog.close()
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
            onPaneClick={() => openWith(null)}
          />
        </ReactFlowProvider>
        <button
          type='button'
          aria-label={`Expand ${workflow.name} workflow preview`}
          onClick={() => openWith(null)}
          className='absolute top-2 right-2 z-10 flex size-[28px] items-center justify-center rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-4)] text-[var(--text-muted)] opacity-0 transition-opacity duration-150 hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-2 group-hover:opacity-100'
        >
          <Expand className='size-[13px]' />
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-label={`${workflow.name} workflow preview`}
        onCancel={(event) => {
          event.preventDefault()
          setExpanded(false)
        }}
        onClose={() => setExpanded(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            setExpanded(false)
        }}
        className='fixed inset-0 m-auto h-[86dvh] max-h-none w-[92vw] max-w-none overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] p-0 text-[var(--text-body)] backdrop:bg-black/70 backdrop:backdrop-blur-sm'
      >
        {expanded && (
          <div className='relative flex h-full w-full flex-col sm:flex-row'>
            <div className='relative min-h-0 min-w-0 flex-1'>
              <div className='pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-center justify-between px-4 py-3'>
                <span className='text-[var(--text-muted)] text-small'>{workflow.name}</span>
                <button
                  ref={closeButtonRef}
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
                  onPaneClick={() => setSelectedId(null)}
                />
              </ReactFlowProvider>
            </div>

            <div className='flex max-h-[50%] min-h-0 w-full flex-shrink-0 flex-col overflow-y-auto border-[var(--border)] border-t sm:max-h-none sm:w-[340px] sm:border-t-0 sm:border-l'>
              <div
                role='group'
                aria-label='Inspect a block'
                className='flex shrink-0 flex-wrap gap-1 border-[var(--border)] border-b p-3'
              >
                {workflow.blocks.map((block) => (
                  <Chip
                    key={block.id}
                    active={selectedId === block.id}
                    aria-pressed={selectedId === block.id}
                    onClick={() => setSelectedId(block.id)}
                  >
                    {block.name}
                  </Chip>
                ))}
              </div>
              {selectedBlock ? (
                <BlockInspector
                  embedded
                  name={selectedBlock.name}
                  type={selectedBlock.type}
                  color={selectedBlock.bgColor}
                  isIntegration={selectedBlock.isIntegration}
                  triggerMode={selectedBlock.triggerMode}
                  fields={inspectorFieldsFor(selectedBlock)}
                  tools={selectedBlock.tools}
                />
              ) : (
                <div className='flex h-full items-center justify-center px-6 text-center text-[var(--text-muted)] text-small'>
                  Select a block to see its full configuration
                </div>
              )}
            </div>
          </div>
        )}
      </dialog>
    </LazyMotion>
  )
}

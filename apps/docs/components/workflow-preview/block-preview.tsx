'use client'

import { useMemo } from 'react'
import { domAnimation, LazyMotion } from 'framer-motion'
import ReactFlow, { type NodeTypes, ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'
import { BLOCK_DISPLAY_WORKFLOWS } from '@/components/workflow-preview/block-display-workflows'
import { DocsBlockNode } from '@/components/workflow-preview/docs-block-node'
import { toReactFlowElements } from '@/components/workflow-preview/workflow-data'

/** The hero mounts the same node type the canvas uses, so it can never drift. */
const NODE_TYPES: NodeTypes = { previewBlock: DocsBlockNode }
const PRO_OPTIONS = { hideAttribution: true }
/** `maxZoom` mirrors the previous hand-rolled hero's 1.3 scale. */
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1.3 } as const

interface BlockPreviewProps {
  /** Block key from {@link BLOCK_DISPLAY_WORKFLOWS} (e.g. `agent`, `condition`, `webhook_trigger`). */
  type: string
}

/**
 * Renders a single block exactly as it appears on the builder canvas, drawn by the
 * shared {@link WorkflowBlockView} (via `DocsBlockNode`) through the same ReactFlow
 * machinery as the multi-block diagrams — never a parallel hand-rolled card. Static
 * and non-interactive (no pan/zoom), centered in a bordered container. Use as the hero
 * on a block reference page: `<BlockPreview type="agent" />`. Edit the source data in
 * `block-display-workflows.ts`.
 */
export function BlockPreview({ type }: BlockPreviewProps) {
  const workflow = BLOCK_DISPLAY_WORKFLOWS[type]

  const elements = useMemo(() => (workflow ? toReactFlowElements(workflow) : null), [workflow])

  if (!workflow || !elements) return null

  return (
    <div
      className='not-prose my-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]'
      style={{ height: 400 }}
    >
      <LazyMotion features={domAnimation}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={elements.nodes}
            edges={elements.edges}
            nodeTypes={NODE_TYPES}
            proOptions={PRO_OPTIONS}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            minZoom={0.2}
            maxZoom={1.3}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            panOnDrag={false}
            panOnScroll={false}
            preventScrolling={false}
            className='h-full w-full'
          />
        </ReactFlowProvider>
      </LazyMotion>
    </div>
  )
}

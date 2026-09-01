import type { EdgeTypes, NodeTypes } from '@xyflow/react'
import dynamic from 'next/dynamic'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { ConnectionBlockSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/connection-block-selector/connection-block-selector'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'

/**
 * Lazily loaded note node. Defined once at module scope so the {@link nodeTypes}
 * map stays referentially stable for ReactFlow. Loading it dynamically keeps its
 * heavy markdown dependencies (Streamdown, remark-breaks) off the editor's
 * critical path — they load only when a workflow actually contains a note block.
 * `ssr: false` is safe because the note node is canvas-only and never rendered
 * on the server.
 */
const NoteBlock = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block').then(
      (mod) => mod.NoteBlock
    ),
  { ssr: false }
)

/** Custom node types for ReactFlow. */
export const nodeTypes: NodeTypes = {
  connectionBlockSelector: ConnectionBlockSelector,
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  subflowNode: SubflowNodeComponent,
}

/** Custom edge types for ReactFlow. */
export const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

/** ReactFlow configuration constants. */
export const defaultEdgeOptions = { type: 'custom' } as const

export const reactFlowStyles = [
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  String.raw`[&_.react-flow\_\_selection]:!border-[var(--text-secondary)]`,
  String.raw`[&_.react-flow\_\_selection]:!bg-[color-mix(in_oklch,var(--text-secondary)_8%,transparent)]`,
  '[&_.react-flow__background]:hidden',
  '[&_.react-flow__node-subflowNode.selected]:!shadow-none',
].join(' ')

export const reactFlowFitViewOptions = { padding: 0.6, maxZoom: 1.0 } as const
export const embeddedFitViewOptions = { padding: 0.15, maxZoom: 0.85, minZoom: 0.1 } as const
export const embeddedResizeFitViewOptions = { ...embeddedFitViewOptions, duration: 0 } as const
export const reactFlowProOptions = { hideAttribution: true } as const

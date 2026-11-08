import type { EdgeTypes, NodeTypes } from '@xyflow/react'
import dynamic from 'next/dynamic'
import { ConnectionBlockSelector } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/connection-block-selector/connection-block-selector'
import { SubflowNodeComponent } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/subflow-node/subflow-node'
import { WorkflowBlock } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/workflow-block'
import { WorkflowEdge } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-edge/workflow-edge'

/**
 * Lazily loaded note node. Defined once at module scope so the {@link nodeTypes}
 * map stays referentially stable for ReactFlow. Loading it dynamically keeps its
 * heavy markdown dependencies off the editor's critical path — they load only
 * when a workflow actually contains a note block. `ssr: false` is safe because
 * the note node is canvas-only and never rendered on the server.
 */
const NoteBlock = dynamic(
  () =>
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/note-block/note-block'
    ).then((mod) => mod.NoteBlock),
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

export const reactFlowFitViewOptions = { padding: 0.6, maxZoom: 1.0 } as const
export const reactFlowProOptions = { hideAttribution: true } as const

/**
 * Fit and centre math measures React Flow's own box: the zone's panel and terminal are not the legacy
 * `--panel-width`/`--terminal-height` insets the legacy stores still publish on the document.
 */
export const CANVAS_VIEWPORT_OPTIONS = { embedded: true } as const

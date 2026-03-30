import type { EdgeTypes, NodeTypes } from 'reactflow'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'

export const DEFAULT_PASTE_OFFSET = { x: 50, y: 50 } as const

export const CHILD_EXTENT: [[number, number], [number, number]] = [
  [16, 42],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
]

export const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  subflowNode: SubflowNodeComponent,
}

export const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

export const defaultEdgeOptions = { type: 'custom' } as const

export const reactFlowStyles = [
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__edge-labels]:!z-[1001]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  '[&_.react-flow__background]:hidden',
  '[&_.react-flow__node-subflowNode.selected]:!shadow-none',
].join(' ')

export const reactFlowFitViewOptions = { padding: 0.6, maxZoom: 1.0 } as const
export const embeddedFitViewOptions = { padding: 0.15, maxZoom: 0.85, minZoom: 0.1 } as const
export const embeddedResizeFitViewOptions = { ...embeddedFitViewOptions, duration: 0 } as const
export const reactFlowProOptions = { hideAttribution: true } as const

export const CONNECTION_LINE_STYLE_ERROR = {
  stroke: 'var(--text-error)',
  strokeWidth: 2,
} as const

export const CONNECTION_LINE_STYLE_DEFAULT = {
  stroke: 'var(--workflow-edge)',
  strokeWidth: 2,
} as const

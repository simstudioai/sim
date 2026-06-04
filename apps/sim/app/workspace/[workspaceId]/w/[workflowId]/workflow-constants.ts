import type { EdgeTypes, NodeTypes } from 'reactflow'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'

/** Custom node types for ReactFlow. */
export const nodeTypes: NodeTypes = {
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

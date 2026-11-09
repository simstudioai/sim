import { connectedWorkflowState } from '@/stores/workflows/state-port/connection'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const EMPTY: Pick<WorkflowState, 'blocks' | 'edges'> = { blocks: {}, edges: [] }

/**
 * The workflow store as the chat run tool's execution, the stream helpers and the operation queue
 * read it. Before the real store connects nothing has hydrated a workflow, so a chat run finds no
 * edges to mark; after, they read the editor's workflow.
 */
export const useWorkflowStore = {
  getState: () => connectedWorkflowState()?.workflow.getState() ?? EMPTY,
}

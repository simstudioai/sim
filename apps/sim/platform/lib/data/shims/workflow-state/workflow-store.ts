import { connectedWorkflowState } from '@/platform/lib/data/shims/workflow-state/connection'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const EMPTY: Pick<WorkflowState, 'blocks' | 'edges'> = { blocks: {}, edges: [] }

/**
 * Stands in for `stores/workflows/workflow/store` where the shared socket provider and the chat run
 * tool's execution import it. Before the Workflows tab connects the real store nothing has hydrated a
 * workflow, so a chat run finds no edges to mark; after, both read the canvas's workflow.
 */
export const useWorkflowStore = {
  getState: () => connectedWorkflowState()?.workflow.getState() ?? EMPTY,
}

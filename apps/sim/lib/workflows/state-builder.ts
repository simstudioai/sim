import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Build workflow state in the same format as the deployment process
 * This utility ensures consistent state format between template creation and deployment
 */
export function buildWorkflowStateForTemplate(workflowId: string) {
  const workflowStore = useWorkflowStore.getState()
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  // Get current workflow state
  const { blocks, edges } = workflowStore

  // Generate loops and parallels in the same format as deployment
  const loops = workflowStore.generateLoopBlocks()
  const parallels = workflowStore.generateParallelBlocks()

  // Build the state object in the same format as deployment
  const state = {
    blocks,
    edges,
    loops,
    parallels,
    lastSaved: Date.now(),
  }

  return state
}

import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { mergeSubblockState } from '@/stores/workflows/utils'

const logger = createLogger('WorkflowHelpers')

export function buildUserWorkflowJson(providedWorkflowId?: string): string {
  // Determine workflowId from provided or active registry state
  let workflowId = providedWorkflowId
  if (!workflowId) {
    const { activeWorkflowId } = useWorkflowRegistry.getState()
    if (!activeWorkflowId) {
      throw new Error('No active workflow found')
    }
    workflowId = activeWorkflowId
  }

  // Prefer diff/preview store if it has content
  const diffStore = useWorkflowDiffStore.getState()
  let workflowState: any = null

  if (diffStore.diffWorkflow && Object.keys(diffStore.diffWorkflow.blocks || {}).length > 0) {
    workflowState = diffStore.diffWorkflow
    logger.info('Using workflow from diff/preview store', { workflowId })
  } else {
    // Fallback to full workflow store
    const workflowStore = useWorkflowStore.getState()
    const fullWorkflowState = workflowStore.getWorkflowState()

    if (!fullWorkflowState || !fullWorkflowState.blocks) {
      // Fallback to registry metadata
      const workflowRegistry = useWorkflowRegistry.getState()
      const workflow = workflowRegistry.workflows[workflowId]

      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found in any store`)
      }

      logger.warn('No workflow state found, using workflow metadata only')
      workflowState = workflow
    } else {
      workflowState = fullWorkflowState
    }
  }

  if (workflowState) {
    if (!workflowState.loops) workflowState.loops = {}
    if (!workflowState.parallels) workflowState.parallels = {}
    if (!workflowState.edges) workflowState.edges = []
    if (!workflowState.blocks) workflowState.blocks = {}
  }

  try {
    if (workflowState?.blocks) {
      workflowState = {
        ...workflowState,
        blocks: mergeSubblockState(workflowState.blocks, workflowId),
      }
      logger.info('Merged subblock values into workflow state', {
        workflowId,
        blockCount: Object.keys(workflowState.blocks || {}).length,
      })
    }
  } catch (_mergeError) {
    logger.warn('Failed to merge subblock values; proceeding with raw workflow state')
  }

  if (!workflowState || !workflowState.blocks) {
    throw new Error('Workflow state is empty or invalid')
  }

  try {
    return JSON.stringify(workflowState, null, 2)
  } catch (stringifyError) {
    throw new Error(
      `Failed to convert workflow to JSON: ${
        stringifyError instanceof Error ? stringifyError.message : 'Unknown error'
      }`
    )
  }
} 
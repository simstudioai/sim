import { WorkflowIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console-logger'
import type { BlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('WorkflowBlock')

interface WorkflowResponse extends ToolResponse {
  output: {
    success: boolean
    childWorkflowName: string
    result: any
    error?: string
  }
}

// Helper function to get available workflows for the dropdown
const getAvailableWorkflows = (): Array<{ label: string; id: string }> => {
  try {
    const { workflows, activeWorkflowId } = useWorkflowRegistry.getState()

    // Filter out the current workflow to prevent recursion
    const availableWorkflows = Object.entries(workflows)
      .filter(([id]) => id !== activeWorkflowId)
      .map(([id, workflow]) => ({
        label: workflow.name || `Workflow ${id.slice(0, 8)}`,
        id: id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    return availableWorkflows
  } catch (error) {
    logger.error('Error getting available workflows:', error)
    return []
  }
}

export const WorkflowBlock: BlockConfig = {
  type: 'workflow',
  name: 'Workflow',
  description: 'Execute another workflow',
  category: 'blocks',
  bgColor: '#705335',
  icon: WorkflowIcon,
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'dropdown',
      options: getAvailableWorkflows,
    },
    {
      id: 'input',
      title: 'Input Variable (Optional)',
      type: 'short-input',
      placeholder: 'Select a variable to pass to the child workflow',
      description: 'This variable will be available as start.input in the child workflow',
    },
  ],
  tools: {
    access: ['workflow_executor'],
  },
  inputs: {
    workflowId: {
      type: 'string',
      required: true,
      description: 'ID of the workflow to execute',
    },
    input: {
      type: 'string',
      required: false,
      description: 'Variable reference to pass to the child workflow',
    },
  },
  outputs: {
    success: 'boolean',
    childWorkflowName: 'string',
    result: 'json',
    error: 'string',
  },
}

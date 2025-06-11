import { ComponentIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

const logger = createLogger('WorkflowBlock')

interface WorkflowResponse extends ToolResponse {
  output: {
    [key: string]: any
    success: boolean
    duration?: number
    childWorkflowId: string
    childWorkflowName: string
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
        id: id
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
  description: 'Execute another workflow as a block',
  category: 'blocks',
  bgColor: '#6366f1',
  icon: ComponentIcon,
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'dropdown',
      options: getAvailableWorkflows,
    },
  ],
  tools: {
    access: ['workflow_executor'],
  },
  inputs: {
    workflowId: {
      type: 'string',
      required: true,
      description: 'ID of the workflow to execute'
    }
  },
  outputs: {
    response: {
      type: {
        success: 'boolean',
        duration: 'number',
        childWorkflowId: 'string',
        childWorkflowName: 'string',
        error: 'string'
      }
    }
  }
}

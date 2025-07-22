import { WorkflowIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console-logger'
import type { BlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowBlock')

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
      id: 'workflowInputFormat',
      title: 'Input Fields',
      type: 'input-format',
      mode: 'basic',
      condition: {
        field: 'workflowId',
        value: '',
        not: true,
      },
      description:
        "Fill in the input values for the selected workflow. These fields are defined in the target workflow's start block.",
    },
    {
      id: 'jsonInput',
      title: 'JSON Input',
      type: 'code',
      language: 'json',
      generationType: 'json-object',
      mode: 'advanced',
      condition: {
        field: 'workflowId',
        value: '',
        not: true,
      },
      description: 'Provide JSON data to send to the workflow',
      placeholder: '{\n  "key": "value",\n  "nested": {\n    "field": "data"\n  }\n}',
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
  },
  outputs: {
    // Dynamic outputs - the workflow block now returns whatever the child workflow returns
    // This allows direct access to child workflow outputs without wrapper
  },
}

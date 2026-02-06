import { WorkflowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const WorkflowBlock: BlockConfig = {
  type: 'workflow',
  name: 'Workflow',
  description:
    'This is a core workflow block. Execute another workflow as a block in your workflow. Enter the input variable to pass to the child workflow.',
  category: 'blocks',
  bgColor: '#6366F1',
  icon: WorkflowIcon,
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'workflow-selector',
      placeholder: 'Search workflows...',
      required: true,
    },
    {
      id: 'input',
      title: 'Input Variable',
      type: 'short-input',
      placeholder: 'Select a variable to pass to the child workflow',
      description: 'This variable will be available as start.input in the child workflow',
      required: false,
    },
  ],
  tools: {
    access: ['workflow_executor'],
  },
  inputs: {
    workflowId: {
      type: 'string',
      description: 'ID of the workflow to execute',
    },
    input: {
      type: 'string',
      description: 'Variable reference to pass to the child workflow',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Execution success status' },
    childWorkflowName: { type: 'string', description: 'Child workflow name' },
    childWorkflowId: { type: 'string', description: 'Child workflow ID' },
    result: { type: 'json', description: 'Workflow execution result' },
    error: { type: 'string', description: 'Error message' },
    childTraceSpans: {
      type: 'json',
      description: 'Child workflow trace spans',
      hiddenFromDisplay: true,
    },
  },
  hideFromToolbar: true,
}

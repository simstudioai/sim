import { WorkflowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

// Helper: list workflows excluding self
const getAvailableWorkflows = (): Array<{ label: string; id: string }> => {
  try {
    const { workflows, activeWorkflowId } = useWorkflowRegistry.getState()
    return Object.entries(workflows)
      .filter(([id]) => id !== activeWorkflowId)
      .map(([id, w]) => ({ label: w.name || `Workflow ${id.slice(0, 8)}`, id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return []
  }
}

// New workflow block variant that visualizes child Input Trigger schema for mapping
export const WorkflowInputBlock: BlockConfig = {
  type: 'workflow_input',
  name: 'Workflow',
  description: 'Execute another workflow and map variables to its Start trigger schema.',
  longDescription: `Execute another child workflow and map variables to its Start trigger schema. Helps with modularizing workflows.`,
  bestPractices: `
  - Usually clarify/check if the user has tagged a workflow to use as the child workflow. Understand the child workflow to determine the logical position of this block in the workflow.
  - Remember, that the start point of the child workflow is the Start block.
  `,
  category: 'blocks',
  bgColor: '#6366F1', // Indigo - modern and professional
  icon: WorkflowIcon,
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'dropdown',
      options: getAvailableWorkflows,
      required: true,
    },
    // Renders dynamic mapping UI based on selected child workflow's Start trigger inputFormat
    {
      id: 'inputMapping',
      title: 'Input Mapping',
      type: 'input-mapping',
      description:
        "Map fields defined in the child workflow's Start block to variables/values in this workflow.",
      dependsOn: ['workflowId'],
    },
  ],
  tools: {
    access: ['workflow_executor'],
  },
  inputs: {
    workflowId: { type: 'string', description: 'ID of the child workflow' },
    inputMapping: { type: 'json', description: 'Mapping of input fields to values' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Execution success status' },
    childWorkflowName: { type: 'string', description: 'Child workflow name' },
    result: { type: 'json', description: 'Workflow execution result' },
    error: { type: 'string', description: 'Error message' },
  },
}

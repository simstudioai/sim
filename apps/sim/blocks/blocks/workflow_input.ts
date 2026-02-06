import { WorkflowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

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
  docsLink: 'https://docs.sim.ai/blocks/workflow',
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
      id: 'inputMapping',
      title: 'Inputs',
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
    childWorkflowId: { type: 'string', description: 'Child workflow ID' },
    result: { type: 'json', description: 'Workflow execution result' },
    error: { type: 'string', description: 'Error message' },
    childTraceSpans: {
      type: 'json',
      description: 'Child workflow trace spans',
      hiddenFromDisplay: true,
    },
  },
}

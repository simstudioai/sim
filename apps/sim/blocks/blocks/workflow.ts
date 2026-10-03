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
  canvasPresentation: {
    defaultTitle: 'Workflow',
    sentences: {
      default: [
        { text: 'Run', field: ['workflowId', 'manualWorkflowId'], core: true },
        { text: ', passing', field: 'input' },
      ],
    },
  },
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'workflow-selector',
      canonicalParamId: 'workflowId',
      selectorKey: 'sim.workflows',
      placeholder: 'Search workflows...',
      required: true,
      mode: 'basic',
    },
    {
      id: 'manualWorkflowId',
      title: 'Workflow ID',
      type: 'short-input',
      canonicalParamId: 'workflowId',
      placeholder: 'Enter workflow ID',
      required: true,
      mode: 'advanced',
    },
    {
      id: 'input',
      title: 'Input Variable',
      type: 'short-input',
      placeholder: 'Select a variable to pass to the child workflow',
      description: 'This variable will be available as start.input in the child workflow',
      required: false,
    },
    {
      /**
       * Only meaningful when this block is used as an agent tool: on the canvas the
       * child's inputs are wired through `input`, but a tool row has to collect them
       * per-field. `context: 'tool-input'` keeps it off the canvas, and declaring it
       * here is what lets the tool row build its fields from sub-blocks alone instead
       * of a hard-coded `workflow_executor` branch.
       */
      id: 'inputMapping',
      title: 'Workflow Inputs',
      type: 'workflow-input-mapper',
      context: 'tool-input',
      dependsOn: ['workflowId'],
      condition: { field: 'workflowId', value: '', not: true },
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
  sunset: { status: 'legacy', replacedBy: 'workflow_input' },
}

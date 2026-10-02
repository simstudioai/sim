import { HumanInTheLoopIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const HumanInTheLoopBlock: BlockConfig = {
  type: 'human_in_the_loop',
  name: 'Human',
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'human_in_the_loop_v2' },
  description: 'Pause workflow execution and wait for human input',
  longDescription:
    'Combines response and start functionality. Sends structured responses and allows workflow to resume from this point.',
  category: 'blocks',
  bgColor: '#10B981',
  docsLink: 'https://docs.sim.ai/workflows/blocks/human-in-the-loop',
  icon: HumanInTheLoopIcon,
  canvasPresentation: {
    typeLabel: 'Human',
    defaultTitle: 'Wait for Input',
    sentences: {
      default: ['Pause execution until a human responds'],
    },
  },
  subBlocks: [
    {
      id: 'builderData',
      title: 'Display Data',
      type: 'response-format',
      description:
        'Define the structure of your response data. Use <variable.name> in field names to reference workflow variables.',
    },
    {
      id: 'notification',
      title: 'Notification (Send URL)',
      type: 'tool-input',
      description: 'Configure notification tools to alert approvers (e.g., Slack, Email)',
      defaultValue: [],
    },
    {
      id: 'inputFormat',
      title: 'Resume Form',
      type: 'input-format',
      description: 'Define the fields the approver can fill in when resuming',
    },
  ],
  tools: { access: [] },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation mode: human or api',
    },
    inputFormat: {
      type: 'json',
      description: 'Input fields for resume',
    },
    notification: {
      type: 'json',
      description: 'Notification tools configuration',
    },
    dataMode: {
      type: 'string',
      description: 'Response data definition mode',
    },
    builderData: {
      type: 'json',
      description: 'Structured response data',
    },
    data: {
      type: 'json',
      description: 'JSON response body',
    },
    status: {
      type: 'number',
      description: 'HTTP status code',
    },
    headers: {
      type: 'json',
      description: 'Response headers',
    },
  },
  outputs: {
    url: { type: 'string', description: 'Resume UI URL' },
    resumeEndpoint: {
      type: 'string',
      description: 'Resume API endpoint URL for direct curl requests',
    },
    response: {
      type: 'json',
      description: 'Display data shown to the approver',
      hiddenFromDisplay: true,
    },
    submission: {
      type: 'json',
      description: 'Form submission data from the approver',
      hiddenFromDisplay: true,
    },
    resumeInput: {
      type: 'json',
      description: 'Raw input data submitted when resuming',
      hiddenFromDisplay: true,
    },
    submittedAt: { type: 'string', description: 'ISO timestamp when the workflow was resumed' },
  },
}

/**
 * The Human block, with its notification tools executed the way every other surface
 * executes a block tool.
 *
 * v1 handed a notification tool its stored sub-block values verbatim: no canonical
 * basic/advanced resolution, so a channel chosen in advanced mode arrived under
 * `manualChannel` and the tool's declared `channel` was never set; and no
 * `tools.config.params` transform, so the block's own mapping never ran. v2 applies
 * both, which changes what a configured tool receives — hence a new version rather
 * than a fix in place.
 *
 * Everything else — sub-blocks, outputs, pause/resume, the resume page — is identical,
 * so it is inherited rather than restated.
 */
export const HumanInTheLoopV2Block: BlockConfig = {
  ...HumanInTheLoopBlock,
  type: 'human_in_the_loop_v2',
  hideFromToolbar: false,
  sunset: undefined,
}

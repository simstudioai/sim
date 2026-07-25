import { StartIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const StartTriggerBlock: BlockConfig = {
  type: 'start_trigger',
  triggerAllowed: true,
  name: 'Start',
  description: 'Unified workflow entry point for chat, manual and API runs',
  longDescription:
    'Single workflow entry point: define structured inputs for manual runs and API executions, and receive messages from deployed chat.',
  bestPractices: `
  - The Start block always exposes "input", "conversationId", and "files" — deployed chat sends the user's message as "input".
  - Add custom input format fields to define the payload manual runs and API executions send.
  - Input format fields are supplied by the caller — typed into the Run panel inside the editor, or sent as JSON in an API request body. Deploying does not render them as a fillable page: the deployed surfaces are an API endpoint, a chat UI, and MCP tools.
  - Test manual runs by pre-filling default values inside the input format fields.
  `,
  category: 'triggers',
  bgColor: '#34B5FF',
  docsLink: 'https://docs.sim.ai/workflows/triggers/start',
  icon: StartIcon,
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Inputs',
      type: 'input-format',
      description: 'Add custom fields beyond the built-in input, conversationId, and files fields.',
    },
    {
      id: 'runMetadata',
      title: 'Add run metadata',
      type: 'switch',
      mode: 'advanced',
      defaultValue: false,
      description:
        'Expose trusted, server-injected run metadata under <start.metadata>: userEmail, workspaceId, workflowId, executionId, executionType, executionMode, startTime. Fields describe the invoking run — inside a custom block they identify the calling user and workflow.',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: {},
  triggers: {
    enabled: true,
    available: ['chat', 'manual', 'api'],
  },
}

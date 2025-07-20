import { StagehandIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { StagehandAgentResponse } from '@/tools/stagehand/types'

export const StagehandAgentBlock: BlockConfig<StagehandAgentResponse> = {
  type: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Autonomous web browsing agent',
  longDescription:
    'Use Stagehand to create an autonomous web browsing agent that can navigate across websites, perform tasks, and return structured data.',
  docsLink: 'https://docs.simstudio.ai/tools/stagehand_agent',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'startUrl',
      title: 'Starting URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the starting URL for the agent',
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Enter the task or goal for the agent to achieve. Reference variables using %key% syntax.',
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
    },
    {
      id: 'apiKey',
      title: 'Anthropic API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Anthropic API key',
      password: true,
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      generationType: 'json-schema',
    },
  ],
  tools: {
    access: ['stagehand_agent'],
    config: {
      tool: () => 'stagehand_agent',
    },
  },
  inputs: {
    startUrl: { type: 'string', required: true },
    task: { type: 'string', required: true },
    variables: { type: 'json', required: false },
    apiKey: { type: 'string', required: true },
    outputSchema: { type: 'json', required: false },
  },
  outputs: {
    agentResult: 'json',
    structuredOutput: 'any',
  },
}

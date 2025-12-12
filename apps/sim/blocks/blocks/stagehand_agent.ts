import { StagehandIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { StagehandAgentResponse } from '@/tools/stagehand/types'

export const StagehandAgentBlock: BlockConfig<StagehandAgentResponse> = {
  type: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Autonomous web browsing agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Stagehand Agent into the workflow. Can navigate the web and perform tasks.',
  docsLink: 'https://docs.sim.ai/tools/stagehand_agent',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'startUrl',
      title: 'Starting URL',
      type: 'short-input',
      placeholder: 'Enter the starting URL for the agent',
      required: true,
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder:
        'Enter the task or goal for the agent to achieve. Reference variables using %key% syntax.',
      required: true,
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'table',
      columns: ['Key', 'Value'],
    },
    {
      id: 'apiKey',
      title: 'Anthropic API Key',
      type: 'short-input',
      placeholder: 'Enter your Anthropic API key',
      password: true,
      required: true,
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
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
    startUrl: { type: 'string', description: 'Starting URL for agent' },
    task: { type: 'string', description: 'Task description' },
    variables: { type: 'json', description: 'Task variables' },
    apiKey: { type: 'string', description: 'Anthropic API key' },
    outputSchema: { type: 'json', description: 'Output schema' },
  },
  outputs: {
    agentResult: { type: 'json', description: 'Agent execution result' },
    structuredOutput: { type: 'json', description: 'Structured output data' },
  },
}

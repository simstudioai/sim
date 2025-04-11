import { StagehandIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface StagehandAgentResponse extends ToolResponse {
  output: {
    agentResult: {
      success: boolean
      completed: boolean
      message: string
      actions: Array<{
        type: string
        params: Record<string, any>
        result: Record<string, any>
      }>
    }
    structuredOutput?: Record<string, any>
  }
}

export const StagehandAgentBlock: BlockConfig<StagehandAgentResponse> = {
  type: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Autonomous web browsing agent',
  longDescription:
    'Use Stagehand to create an autonomous web browsing agent that can navigate across websites, perform tasks, and return structured data.',
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
      title: 'OpenAI API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your OpenAI API key',
      password: true,
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      layout: 'full',
      placeholder: `Enter JSON Schema...`,
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
    response: {
      type: {
        agentResult: 'json',
        structuredOutput: 'any',
      },
    },
  },
}

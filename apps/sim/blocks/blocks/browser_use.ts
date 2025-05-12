import { BrowserUseIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface BrowserUseResponse extends ToolResponse {
  output: {
    id: string
    task: string
    output: string | null
    status: string
    steps: any[]
    live_url: string | null
  }
}

export const BrowserUseBlock: BlockConfig<BrowserUseResponse> = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  longDescription:
    'Execute browser automation tasks with BrowserUse to navigate the web, scrape data, and perform actions as if a real user was interacting with the browser. The task runs asynchronously and the block will poll for completion before returning results.',
  docsLink: 'https://docs.simstudio.ai/tools/browser_use',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: BrowserUseIcon,
  subBlocks: [
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Describe what the browser agent should do...',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'Enter your BrowserUse API key',
    },
    {
      id: 'pollInterval',
      title: 'Poll Interval (ms)',
      type: 'short-input',
      layout: 'half',
      placeholder: '5000',
    },
    {
      id: 'maxPollTime',
      title: 'Max Poll Time (ms)',
      type: 'short-input',
      layout: 'half',
      placeholder: '300000',
    },
  ],
  tools: {
    access: ['browser_use_run_task'],
  },
  inputs: {
    task: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    pollInterval: { type: 'number', required: false },
    maxPollTime: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        id: 'string',
        task: 'string',
        output: 'any',
        status: 'string',
        steps: 'json',
        live_url: 'any',
      },
    },
  },
}

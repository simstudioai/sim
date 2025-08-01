import { BrowserUseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { BrowserUseResponse } from '@/tools/browser_use/types'

export const BrowserUseBlock: BlockConfig<BrowserUseResponse> = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  longDescription:
    'Execute browser automation tasks with BrowserUse to navigate the web, scrape data, and perform actions as if a real user was interacting with the browser. The task runs asynchronously and the block will poll for completion before returning results.',
  docsLink: 'https://docs.sim.ai/tools/browser_use',
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
      required: true,
    },
    {
      id: 'variables',
      title: 'Variables (Secrets)',
      type: 'table',
      layout: 'full',
      columns: ['Key', 'Value'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'gpt-4o', id: 'gpt-4o' },
        { label: 'gemini-2.0-flash', id: 'gemini-2.0-flash' },
        { label: 'gemini-2.0-flash-lite', id: 'gemini-2.0-flash-lite' },
        { label: 'claude-3-7-sonnet-20250219', id: 'claude-3-7-sonnet-20250219' },
        { label: 'llama-4-maverick-17b-128e-instruct', id: 'llama-4-maverick-17b-128e-instruct' },
      ],
    },
    {
      id: 'save_browser_data',
      title: 'Save Browser Data',
      type: 'switch',
      layout: 'half',
      placeholder: 'Save browser data',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'Enter your BrowserUse API key',
      required: true,
    },
  ],
  tools: {
    access: ['browser_use_run_task'],
  },
  inputs: {
    task: { type: 'string', description: 'Browser automation task' },
    apiKey: { type: 'string', description: 'BrowserUse API key' },
    variables: { type: 'json', description: 'Task variables' },
    model: { type: 'string', description: 'AI model to use' },
    save_browser_data: { type: 'boolean', description: 'Save browser data' },
  },
  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'any', description: 'Task output data' },
    steps: { type: 'json', description: 'Execution steps taken' },
  },
}

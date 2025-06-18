import { BrowserUseIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

interface BrowserUseResponse extends ToolResponse {
  output: {
    id: string
    success: boolean
    output: any
    steps: any[]
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
    },
  ],
  tools: {
    access: ['browser_use_run_task'],
  },
  inputs: {
    task: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    variables: { type: 'json', required: false },
    model: { type: 'string', required: false },
    save_browser_data: { type: 'boolean', required: false },
  },
  outputs: {
    response: {
      type: {
        id: 'string',
        success: 'boolean',
        output: 'any',
        steps: 'json',
      },
    },
  },
}

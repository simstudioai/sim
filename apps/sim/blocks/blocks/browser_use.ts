import { BrowserUseIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { BrowserUseResponse } from '@/tools/browser_use/types'

export const BrowserUseBlock: BlockConfig<BrowserUseResponse> = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Browser Use into the workflow. Can navigate the web and perform actions as if a real user was interacting with the browser.',
  docsLink: 'https://docs.sim.ai/tools/browser_use',
  category: 'tools',
  bgColor: '#181C1E',
  icon: BrowserUseIcon,
  subBlocks: [
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder: 'Describe what the browser agent should do...',
      required: true,
    },
    {
      id: 'variables',
      title: 'Variables (Secrets)',
      type: 'table',
      columns: ['Key', 'Value'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Browser Use LLM', id: 'browser-use-llm' },
        { label: 'GPT-4o', id: 'gpt-4o' },
        { label: 'GPT-4o Mini', id: 'gpt-4o-mini' },
        { label: 'GPT-4.1', id: 'gpt-4.1' },
        { label: 'GPT-4.1 Mini', id: 'gpt-4.1-mini' },
        { label: 'O3', id: 'o3' },
        { label: 'O4 Mini', id: 'o4-mini' },
        { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
        { label: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
        { label: 'Gemini 3 Pro Preview', id: 'gemini-3-pro-preview' },
        { label: 'Gemini Flash Latest', id: 'gemini-flash-latest' },
        { label: 'Gemini Flash Lite Latest', id: 'gemini-flash-lite-latest' },
        { label: 'Claude 3.7 Sonnet', id: 'claude-3-7-sonnet-20250219' },
        { label: 'Claude Sonnet 4', id: 'claude-sonnet-4-20250514' },
        { label: 'Claude Sonnet 4.5', id: 'claude-sonnet-4-5-20250929' },
        { label: 'Claude Opus 4.5', id: 'claude-opus-4-5-20251101' },
        { label: 'Llama 4 Maverick', id: 'llama-4-maverick-17b-128e-instruct' },
      ],
    },
    {
      id: 'save_browser_data',
      title: 'Save Browser Data',
      type: 'switch',
      placeholder: 'Save browser data',
    },
    {
      id: 'profile_id',
      title: 'Profile ID',
      type: 'short-input',
      placeholder: 'Enter browser profile ID (optional)',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
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
    profile_id: { type: 'string', description: 'Browser profile ID for persistent sessions' },
  },
  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'json', description: 'Task output data' },
    steps: { type: 'json', description: 'Execution steps taken' },
  },
}

import { StagehandIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

interface StagehandExtractResponse extends ToolResponse {
  output: {
    data: Record<string, any>
  }
}

export const StagehandBlock: BlockConfig<StagehandExtractResponse> = {
  type: 'stagehand',
  name: 'Stagehand Extract',
  description: 'Extract data from websites',
  longDescription:
    'Use Stagehand to extract structured data from webpages using Browserbase and OpenAI.',
  docsLink: 'https://docs.simstudio.ai/tools/stagehand',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the URL of the website to extract data from',
    },
    {
      id: 'instruction',
      title: 'Instruction',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter detailed instructions for what data to extract from the page...',
    },
    {
      id: "env",
      title: 'Environment',
      type: 'combobox',
      layout: 'full',
      placeholder: 'Select the environment for extraction',
      options: [
        { id: 'browserbase', label: 'Browserbase' },
        { id: "local", label: 'Local (Chromium)' },
      ],
    },
    {
      id: "model",
      title: 'Model',
      type: "combobox",
      placeholder: 'Select the model to use for extraction',
      layout: 'full',
      options: [
        { id: 'gpt-4o', label: 'gpt-4o' },
        { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
        { id: 'gpt-4o-2024-08-06', label: 'gpt-4o-2024-08-06' },
        { id: 'gpt-4.5-preview', label: 'gpt-4.5-preview' },
        { id: 'claude-3-5-sonnet-latest', label: 'claude-3-5-sonnet-latest' },
        { id: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022' },
        { id: 'claude-3-5-sonnet-20240620', label: 'claude-3-5-sonnet-20240620' },
        { id: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest' },
        { id: 'claude-3-7-sonnet-20250219', label: 'claude-3-7-sonnet-20250219' },
        { id: 'o1-mini', label: 'o1-mini' },
        { id: 'o1-preview', label: 'o1-preview' },
        { id: 'o3-mini', label: 'o3-mini' },
        { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
        { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
        { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
        { id: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b' },
        { id: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
        { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
        { id: 'gemini-2.5-pro-preview-03-25', label: 'gemini-2.5-pro-preview-03-25' },
        { id: 'cerebras-llama-3.3-70b', label: 'cerebras-llama-3.3-70b' },
        { id: 'cerebras-llama-3.1-8b', label: 'cerebras-llama-3.1-8b' },
        { id: 'groq-llama-3.3-70b-versatile', label: 'groq-llama-3.3-70b-versatile' },
        { id: 'groq-llama-3.3-70b-specdec', label: 'groq-llama-3.3-70b-specdec' }
      ]
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      generationType: 'json-schema',
    },
  ],
  tools: {
    access: ['stagehand_extract'],
    config: {
      tool: () => 'stagehand_extract',
    },
  },
  inputs: {
    url: { type: 'string', required: true },
    instruction: { type: 'string', required: true },
    schema: { type: 'json', required: true },
    apiKey: { type: 'string', required: true },
    model: { type: 'string', required: true },
    env: { type: 'string', required: true, },
  },
  outputs: {
    data: 'json',
  },
}

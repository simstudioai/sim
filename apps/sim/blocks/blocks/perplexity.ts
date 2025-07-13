import { PerplexityIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

interface PerplexityChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}

export const PerplexityBlock: BlockConfig<PerplexityChatResponse> = {
  type: 'perplexity',
  name: 'Perplexity',
  description: 'Use Perplexity AI chat models',
  longDescription:
    'Generate completions using Perplexity AI models with real-time knowledge and search capabilities. Create responses, answer questions, and generate content with customizable parameters.',
  docsLink: 'https://docs.simstudio.ai/tools/perplexity',
  category: 'tools',
  bgColor: '#20808D', // Perplexity turquoise color
  icon: PerplexityIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Optional system prompt to guide the model behavior...',
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your prompt here...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Sonar', id: 'sonar' },
        { label: 'Mistral', id: 'mistral' },
        { label: 'Claude-3-Opus', id: 'claude-3-opus' },
        { label: 'Claude-3-Sonnet', id: 'claude-3-sonnet' },
        { label: 'Command-R', id: 'command-r' },
        { label: 'GPT-4o', id: 'gpt-4o' },
      ],
      value: () => 'sonar',
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 1,
      value: () => '0.7',
    },
    {
      id: 'max_tokens',
      title: 'Max Tokens',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Maximum number of tokens',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Perplexity API key',
      password: true,
    },
  ],
  tools: {
    access: ['perplexity_chat'],
    config: {
      tool: () => 'perplexity_chat',
      params: (params) => {
        const toolParams = {
          apiKey: params.apiKey,
          model: params.model,
          content: params.content,
          systemPrompt: params.systemPrompt,
          max_tokens: params.max_tokens ? Number.parseInt(params.max_tokens) : undefined,
          temperature: params.temperature ? Number.parseFloat(params.temperature) : undefined,
        }

        return toolParams
      },
    },
  },
  inputs: {
    content: { type: 'string', required: true },
    systemPrompt: { type: 'string', required: false },
    model: { type: 'string', required: true },
    max_tokens: { type: 'string', required: false },
    temperature: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    content: 'string',
    model: 'string',
    usage: 'json',
  },
}

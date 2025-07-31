import { PerplexityIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { PerplexityChatResponse } from '@/tools/perplexity/types'

export const PerplexityBlock: BlockConfig<PerplexityChatResponse> = {
  type: 'perplexity',
  name: 'Perplexity',
  description: 'Use Perplexity AI chat models',
  longDescription:
    'Generate completions using Perplexity AI models with real-time knowledge and search capabilities. Create responses, answer questions, and generate content with customizable parameters.',
  docsLink: 'https://docs.sim.ai/tools/perplexity',
  category: 'tools',
  bgColor: '#20808D', // Perplexity turquoise color
  icon: PerplexityIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'System prompt to guide the model behavior...',
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your prompt here...',
      required: true,
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
      required: true,
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
    content: { type: 'string', description: 'User prompt content' },
    systemPrompt: { type: 'string', description: 'System instructions' },
    model: { type: 'string', description: 'AI model to use' },
    max_tokens: { type: 'string', description: 'Maximum output tokens' },
    temperature: { type: 'string', description: 'Response randomness' },
    apiKey: { type: 'string', description: 'Perplexity API key' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

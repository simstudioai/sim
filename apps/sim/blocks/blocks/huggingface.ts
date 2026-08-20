import { HuggingFaceIcon } from '@/components/icons'
import type { HuggingFaceChatResponse } from '@/tools/huggingface/types'
import type { BlockConfig } from '../types'

export const HuggingFaceBlock: BlockConfig<HuggingFaceChatResponse> = {
  type: 'huggingface',
  name: 'Hugging Face',
  description: 'Use Hugging Face Inference API',
  longDescription:
    'Generate completions using Hugging Face Inference API with access to various open-source models. Leverage cutting-edge AI models for chat completions, content generation, and AI-powered conversations with customizable parameters.',
  docsLink: 'https://docs.simstudio.ai/tools/huggingface',
  category: 'tools',
  bgColor: '#0B0F19',
  icon: HuggingFaceIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter system prompt to guide the model behavior...',
      rows: 3,
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message here...',
      rows: 3,
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Novita', id: 'novita' },
        { label: 'Cerebras', id: 'cerebras' },
        { label: 'Cohere', id: 'cohere' },
        { label: 'Fal AI', id: 'fal' },
        { label: 'Fireworks', id: 'fireworks' },
        { label: 'Hyperbolic', id: 'hyperbolic' },
        { label: 'HF Inference', id: 'hf-inference' },
        { label: 'Nebius', id: 'nebius' },
        { label: 'Nscale', id: 'nscale' },
        { label: 'Replicate', id: 'replicate' },
        { label: 'SambaNova', id: 'sambanova' },
        { label: 'Together', id: 'together' },
      ],
      value: () => 'novita',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      layout: 'full',
      placeholder:
        'e.g., deepseek/deepseek-v3-0324, llama3.1-8b, meta-llama/Llama-3.2-3B-Instruct-Turbo',
      description: 'The model must be available for the selected provider.',
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      layout: 'half',
      min: 0,
      max: 2,
      value: () => '0.7',
    },
    {
      id: 'maxTokens',
      title: 'Max Tokens',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 1000',
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Hugging Face API token',
      password: true,
    },
  ],
  tools: {
    access: ['huggingface_chat'],
    config: {
      tool: () => 'huggingface_chat',
      params: (params) => {
        const toolParams = {
          apiKey: params.apiKey,
          provider: params.provider,
          model: params.model,
          content: params.content,
          systemPrompt: params.systemPrompt,
          temperature: params.temperature ? Number.parseFloat(params.temperature) : undefined,
          maxTokens: params.maxTokens ? Number.parseInt(params.maxTokens) : undefined,
          stream: false, // Always false
        }

        return toolParams
      },
    },
  },
  inputs: {
    systemPrompt: { type: 'string', required: false },
    content: { type: 'string', required: true },
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    temperature: { type: 'string', required: false },
    maxTokens: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        model: 'string',
        usage: 'json',
      },
    },
  },
}

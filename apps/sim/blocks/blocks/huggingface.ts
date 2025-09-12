import { HuggingFaceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { HuggingFaceChatResponse } from '@/tools/huggingface/types'

export const HuggingFaceBlock: BlockConfig<HuggingFaceChatResponse> = {
  type: 'huggingface',
  name: 'Hugging Face',
  description: 'Use Hugging Face Inference API',
  longDescription:
    'Integrate Hugging Face into the workflow. Can generate completions using the Hugging Face Inference API. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/huggingface',
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
      required: true,
      placeholder: 'Enter your message here...',
      rows: 3,
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      layout: 'half',
      required: true,
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
      required: true,
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
      required: true,
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
    systemPrompt: { type: 'string', description: 'System instructions' },
    content: { type: 'string', description: 'User message content' },
    provider: { type: 'string', description: 'Model provider' },
    model: { type: 'string', description: 'Model identifier' },
    temperature: { type: 'string', description: 'Response randomness' },
    maxTokens: { type: 'string', description: 'Maximum output tokens' },
    apiKey: { type: 'string', description: 'API access token' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage stats' },
  },
}

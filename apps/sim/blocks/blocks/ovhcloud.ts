import { OVHcloudIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { OVHcloudChatResponse, OVHcloudEmbeddingsResponse } from '@/tools/ovhcloud/types'

type OVHcloudResponse = OVHcloudChatResponse | OVHcloudEmbeddingsResponse

export const OVHcloudBlock: BlockConfig<OVHcloudResponse> = {
  type: 'ovhcloud',
  name: 'OVHcloud AI Endpoints',
  description: 'Use OVHcloud AI Endpoints LLM models',
  longDescription:
    'Integrate OVHcloud AI Endpoints models into your workflow. Use the Europe leading cloud provider inference compute, with sovereignty, data privacy and GDPR compliance.',
  authMode: AuthMode.ApiKey,
  docsLink: 'https://docs.sim.ai/tools/ovhcloud',
  category: 'tools',
  bgColor: '#000E9C',
  icon: OVHcloudIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Chat', id: 'ovhcloud_chat' },
        { label: 'Embeddings', id: 'ovhcloud_embeddings' },
      ],
      value: () => 'ovhcloud_chat',
    },
    // Chat operation inputs
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'System prompt to guide the model behavior...',
      condition: { field: 'operation', value: 'ovhcloud_chat' },
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      placeholder: 'Enter your prompt here...',
      required: true,
      condition: { field: 'operation', value: 'ovhcloud_chat' },
    },
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      placeholder: 'Enter your model here...',
      required: true,
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      min: 0,
      max: 1,
      value: () => '0.7',
      condition: { field: 'operation', value: 'ovhcloud_chat' },
    },
    {
      id: 'max_tokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'Maximum number of tokens',
      condition: { field: 'operation', value: 'ovhcloud_chat' },
    },
    // Embeddings operation inputs
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      placeholder: 'Enter text to generate embeddings...',
      required: true,
      condition: { field: 'operation', value: 'ovhcloud_embeddings' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your OVHcloud AI Endpoints API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['ovhcloud_chat', 'ovhcloud_embeddings'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'ovhcloud_chat':
            return 'ovhcloud_chat'
          case 'ovhcloud_embeddings':
            return 'ovhcloud_embeddings'
          default:
            return 'ovhcloud_chat'
        }
      },
      params: (params) => {
        if (params.operation === 'ovhcloud_embeddings') {
          return {
            apiKey: params.apiKey,
            model: params.model,
            input: params.input,
          }
        }

        // Chat params
        const chatParams = {
          apiKey: params.apiKey,
          model: params.model,
          content: params.content,
          systemPrompt: params.systemPrompt,
          max_tokens: params.max_tokens ? Number.parseInt(params.max_tokens) : undefined,
          temperature: params.temperature ? Number.parseFloat(params.temperature) : undefined,
        }

        return chatParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    // Chat operation inputs
    content: { type: 'string', description: 'User prompt content' },
    systemPrompt: { type: 'string', description: 'System instructions' },
    model: { type: 'string', description: 'AI model to use' },
    max_tokens: { type: 'string', description: 'Maximum output tokens' },
    temperature: { type: 'string', description: 'Response randomness' },
    // Embeddings operation inputs
    input: { type: 'string', description: 'Text input for embeddings' },
    // Common
    apiKey: { type: 'string', description: 'OVHcloud API key' },
  },
  outputs: {
    // Chat outputs
    content: { type: 'string', description: 'Generated response' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage' },
    // Embeddings outputs
    embeddings: { type: 'json', description: 'Generated embeddings' },
    embedding_model: { type: 'string', description: 'Embedding model used' },
  },
}
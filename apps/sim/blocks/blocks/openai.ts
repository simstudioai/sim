import { OpenAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const OpenAIBlock: BlockConfig = {
  type: 'openai',
  name: 'Embeddings',
  description: 'Generate Open AI embeddings',
  longDescription:
    "Convert text into numerical vector representations using OpenAI's embedding models. Transform text data into embeddings for semantic search, clustering, and other vector-based operations.",
  category: 'tools',
  docsLink: 'https://docs.simstudio.ai/tools/openai',
  bgColor: '#10a37f',
  icon: OpenAIIcon,
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter text to generate embeddings for',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'text-embedding-3-small', id: 'text-embedding-3-small' },
        { label: 'text-embedding-3-large', id: 'text-embedding-3-large' },
        { label: 'text-embedding-ada-002', id: 'text-embedding-ada-002' },
      ],
      value: () => 'text-embedding-3-small',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your OpenAI API key',
      password: true,
    },
  ],
  tools: {
    access: ['openai_embeddings'],
  },
  inputs: {
    input: { type: 'string', required: true },
    model: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
  },
  outputs: {
    embeddings: 'json',
    model: 'string',
    usage: 'json',
  },
}

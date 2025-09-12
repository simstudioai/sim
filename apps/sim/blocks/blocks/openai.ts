import { OpenAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const OpenAIBlock: BlockConfig = {
  type: 'openai',
  name: 'Embeddings',
  description: 'Generate Open AI embeddings',
  longDescription:
    'Integrate Embeddings into the workflow. Can generate embeddings from text. Requires API Key.',
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/openai',
  bgColor: '#10a37f',
  icon: OpenAIIcon,
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter text to generate embeddings for',
      required: true,
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
      required: true,
    },
  ],
  tools: {
    access: ['openai_embeddings'],
  },
  inputs: {
    input: { type: 'string', description: 'Text to embed' },
    model: { type: 'string', description: 'Embedding model' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

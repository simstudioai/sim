import { PackageSearchIcon } from '@/components/icons'
import type { BlockConfig } from '../types'

export const KnowledgeBlock: BlockConfig = {
  type: 'knowledge',
  name: 'Knowledge',
  description: 'Search knowledge',
  longDescription:
    'Perform semantic vector search across your knowledge base to find the most relevant content. Uses advanced AI embeddings to understand meaning and context, returning the most similar documents to your search query.',
  bgColor: '#00B0B0',
  icon: PackageSearchIcon,
  category: 'blocks',
  docsLink: 'https://docs.simstudio.ai/blocks/knowledge',
  tools: {
    access: ['knowledge_search'],
  },
  inputs: {
    knowledgeBaseId: { type: 'string', required: true },
    query: { type: 'string', required: true },
    topK: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        results: 'json',
        query: 'string',
        knowledgeBaseId: 'string',
        topK: 'number',
        totalResults: 'number',
        message: 'string',
      },
    },
  },
  subBlocks: [
    {
      id: 'knowledgeBaseId',
      title: 'Knowledge Base',
      type: 'knowledge-base-selector',
      layout: 'full',
      placeholder: 'Select knowledge base',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your search query',
    },
    {
      id: 'topK',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter number of results (default: 10)',
    },
  ],
}

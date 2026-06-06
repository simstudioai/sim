import { OpenAIIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const OpenAIBlock: BlockConfig = {
  type: 'openai',
  name: 'Embeddings',
  description: 'Generate Open AI embeddings',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Embeddings into the workflow. Can generate embeddings from text.',
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/tools/openai',
  bgColor: '#10a37f',
  iconColor: '#10A37F',
  icon: OpenAIIcon,
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      placeholder: 'Enter text to generate embeddings for',
      required: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
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

export const OpenAIBlockMeta = {
  tags: ['llm', 'vector-search'],
  templates: [
    {
      icon: OpenAIIcon,
      title: 'Document embedding pipeline',
      prompt:
        'Build a workflow that watches a files folder, chunks each new document, generates embeddings with OpenAI, and upserts vectors into Pinecone with rich metadata for retrieval.',
      modules: ['files', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'sync'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: OpenAIIcon,
      title: 'Knowledge base re-embedder',
      prompt:
        'Create a scheduled workflow that finds documents whose embeddings are stale, regenerates them with OpenAI, and re-upserts the vectors into Pinecone so retrieval stays current.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'sync', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: OpenAIIcon,
      title: 'Semantic duplicate detector',
      prompt:
        'Build a workflow that reads new rows from a table, generates OpenAI embeddings for each, compares them against existing rows by cosine similarity, and flags near-duplicates in an evaluation table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis', 'vector-search'],
    },
    {
      icon: OpenAIIcon,
      title: 'Product catalog semantic search',
      prompt:
        'Create a workflow that embeds each product description from a table with OpenAI, upserts the vectors into Pinecone, and lets an incoming query return the closest matching products by similarity.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: OpenAIIcon,
      title: 'Semantic ticket deduplication',
      prompt:
        'Build a workflow that embeds each new support ticket with OpenAI, searches a Pinecone index of past tickets for near-duplicates, and links the new ticket to the matching thread instead of opening a fresh one.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: OpenAIIcon,
      title: 'FAQ semantic router',
      prompt:
        'Create a workflow that generates OpenAI embeddings for an incoming question, compares it against embedded FAQ entries to find the closest match, and returns the canned answer when similarity is high or escalates to an agent when it is not.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'vector-search'],
    },
    {
      icon: OpenAIIcon,
      title: 'Embedding-based content clustering',
      prompt:
        'Build a scheduled workflow that pulls recent feedback from a table, generates OpenAI embeddings for each entry, clusters them by semantic similarity, and writes the themed groups with representative quotes back to a summary table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation', 'vector-search'],
    },
  ],
} as const satisfies BlockMeta

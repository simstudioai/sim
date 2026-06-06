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
  bgColor: '#000000',
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
      title: 'Multimodal report builder',
      prompt:
        'Create a workflow that takes a topic, generates a written report with OpenAI, produces matching hero images with the OpenAI image model, and saves the bundle as a single file deliverable.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['content', 'automation'],
    },
    {
      icon: OpenAIIcon,
      title: 'OpenAI structured-output evaluator',
      prompt:
        'Build a workflow that runs a tables of test inputs through an OpenAI structured-output schema, compares against expected outputs, and writes pass/fail and diff reasons to an evaluation table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: OpenAIIcon,
      title: 'OpenAI image asset factory',
      prompt:
        'Create a workflow that takes a list of product names from a table, generates on-brand product images with OpenAI, saves them as files, and writes the file URL back to the row.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
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

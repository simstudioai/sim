import { OpenAIIcon } from '@/components/icons'
import { OpenAIBlockDisplay } from '@/blocks/blocks/openai.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const OpenAIBlock: BlockConfig = {
  ...OpenAIBlockDisplay,
  authMode: AuthMode.ApiKey,
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
  url: 'https://openai.com',
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
  skills: [
    {
      name: 'embed-text',
      description:
        'Generate an OpenAI embedding vector for a piece of text to use in semantic search or similarity.',
      content:
        '# Embed Text\n\nConvert text into an OpenAI embedding vector.\n\n## Steps\n1. Take the input text. If it is long, ensure it fits the model context; otherwise chunk it first.\n2. Choose the model — text-embedding-3-small for cost-efficient general use or text-embedding-3-large for higher accuracy. Keep the model consistent with any existing vectors it will be compared against.\n3. Generate the embedding.\n\n## Output\nReturn the embedding vector, the model used, and token usage. Note the vector dimensionality so it can be matched to the destination vector index.',
    },
    {
      name: 'embed-documents-for-retrieval',
      description:
        'Chunk and embed a set of documents so they can be upserted into a vector store for retrieval.',
      content:
        '# Embed Documents for Retrieval\n\nPrepare documents for semantic retrieval by chunking and embedding them.\n\n## Steps\n1. Split each document into reasonably sized chunks with light overlap so context is preserved.\n2. Embed each chunk with a single consistent OpenAI model (e.g., text-embedding-3-small).\n3. Pair each vector with its source metadata (document ID, chunk index, title) ready for upsert into the vector store.\n\n## Output\nReturn the embeddings with their associated metadata and the model used. Report how many chunks were produced and flag any chunk that failed to embed.',
    },
    {
      name: 'find-semantic-duplicates',
      description:
        'Embed items and compare vectors by cosine similarity to flag near-duplicate content.',
      content:
        '# Find Semantic Duplicates\n\nDetect items that mean the same thing even when worded differently.\n\n## Steps\n1. Embed each candidate item with the same OpenAI model used for the existing set.\n2. Compare each new vector against existing vectors using cosine similarity.\n3. Flag pairs above a similarity threshold (e.g., 0.9) as likely duplicates; treat lower scores as distinct.\n\n## Output\nReturn the flagged duplicate pairs with their similarity scores, sorted highest first, so they can be merged or deduplicated.',
    },
  ],
} as const satisfies BlockMeta

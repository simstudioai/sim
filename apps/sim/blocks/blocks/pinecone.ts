import { PineconeIcon } from '@/components/icons'
import { PineconeBlockDisplay } from '@/blocks/blocks/pinecone.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PineconeResponse } from '@/tools/pinecone/types'

export const PineconeBlock: BlockConfig<PineconeResponse> = {
  ...PineconeBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Generate Embeddings', id: 'generate' },
        { label: 'Upsert Text', id: 'upsert_text' },
        { label: 'Search With Text', id: 'search_text' },
        { label: 'Search With Vector', id: 'search_vector' },
        { label: 'Fetch Vectors', id: 'fetch' },
      ],
      value: () => 'generate',
    },
    // Generate embeddings fields
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'multilingual-e5-large', id: 'multilingual-e5-large' },
        { label: 'llama-text-embed-v2', id: 'llama-text-embed-v2' },
        {
          label: 'pinecone-sparse-english-v0',
          id: 'pinecone-sparse-english-v0',
        },
      ],
      condition: { field: 'operation', value: 'generate' },
      value: () => 'multilingual-e5-large',
    },
    {
      id: 'inputs',
      title: 'Text Inputs',
      type: 'long-input',
      placeholder: '[{"text": "Your text here"}]',
      condition: { field: 'operation', value: 'generate' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of text inputs for embedding generation based on the user\'s description. Each item should be an object with a "text" field. Example: [{"text": "First text"}, {"text": "Second text"}]. Return ONLY valid JSON - no explanations.',
        placeholder: 'Describe the texts you want to embed...',
        generationType: 'json-object',
      },
    },
    // Upsert text fields
    {
      id: 'indexHost',
      title: 'Index Host',
      type: 'short-input',
      placeholder: 'https://index-name-abc123.svc.project-id.pinecone.io',
      condition: { field: 'operation', value: 'upsert_text' },
      required: true,
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'default',
      condition: { field: 'operation', value: 'upsert_text' },
      required: true,
    },
    {
      id: 'records',
      title: 'Records',
      type: 'long-input',
      placeholder:
        '{"_id": "rec1", "text": "Apple\'s first product, the Apple I, was released in 1976.", "category": "product"}\n{"_id": "rec2", "chunk_text": "Apples are a great source of dietary fiber.", "category": "nutrition"}',
      condition: { field: 'operation', value: 'upsert_text' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate newline-delimited JSON records for upserting to Pinecone based on the user\'s description. Each line should be a JSON object with "_id", "text" (or "chunk_text"), and optional metadata fields like "category". Return ONLY the newline-delimited JSON records - no explanations.',
        placeholder: 'Describe the records you want to upsert...',
        generationType: 'json-object',
      },
    },
    // Search text fields
    {
      id: 'indexHost',
      title: 'Index Host',
      type: 'short-input',
      placeholder: 'https://index-name-abc123.svc.project-id.pinecone.io',
      condition: { field: 'operation', value: 'search_text' },
      required: true,
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'default',
      condition: { field: 'operation', value: 'search_text' },
      required: true,
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter text to search for',
      condition: { field: 'operation', value: 'search_text' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a search query for semantic search in Pinecone based on the user's description. The query should capture the semantic meaning of what the user wants to find. Return ONLY the search query text - no explanations, no quotes.",
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'topK',
      title: 'Top K Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_text' },
    },
    {
      id: 'fields',
      title: 'Fields to Return',
      type: 'long-input',
      placeholder: '["category", "text"]',
      condition: { field: 'operation', value: 'search_text' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of field names to return from Pinecone search results based on the user\'s description. Example: ["category", "text", "date"]. Return ONLY a valid JSON array - no explanations.',
        placeholder: 'Describe which fields you want returned...',
        generationType: 'json-object',
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      placeholder: '{"category": "product"}',
      condition: { field: 'operation', value: 'search_text' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Pinecone metadata filter object in JSON format based on the user\'s description. Use operators like $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin for comparisons, and $and, $or for combining conditions. Example: {"category": {"$eq": "product"}}. Return ONLY valid JSON - no explanations.',
        placeholder: 'Describe how you want to filter results...',
        generationType: 'json-object',
      },
    },
    {
      id: 'rerank',
      title: 'Rerank Options',
      type: 'long-input',
      placeholder: '{"model": "bge-reranker-v2-m3", "rank_fields": ["text"], "top_n": 2}',
      condition: { field: 'operation', value: 'search_text' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Pinecone rerank options in JSON format based on the user\'s description. Include "model" (e.g., "bge-reranker-v2-m3"), "rank_fields" (array of fields to use for reranking), and optionally "top_n" (number of results to return after reranking). Return ONLY valid JSON - no explanations.',
        placeholder: 'Describe your reranking preferences...',
        generationType: 'json-object',
      },
    },
    // Fetch fields
    {
      id: 'indexHost',
      title: 'Index Host',
      type: 'short-input',
      placeholder: 'https://index-name-abc123.svc.project-id.pinecone.io',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'Namespace',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
    },
    {
      id: 'ids',
      title: 'Vector IDs',
      type: 'long-input',
      placeholder: '["vec1", "vec2"]',
      condition: { field: 'operation', value: 'fetch' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of vector IDs to fetch from Pinecone based on the user\'s description. Example: ["vec1", "vec2", "vec3"]. Return ONLY a valid JSON array - no explanations.',
        placeholder: 'Describe which vector IDs to fetch...',
        generationType: 'json-object',
      },
    },
    // Add vector search fields
    {
      id: 'indexHost',
      title: 'Index Host',
      type: 'short-input',
      placeholder: 'https://index-name-abc123.svc.project-id.pinecone.io',
      condition: { field: 'operation', value: 'search_vector' },
      required: true,
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'default',
      condition: { field: 'operation', value: 'search_vector' },
      required: true,
    },
    {
      id: 'vector',
      title: 'Query Vector',
      type: 'long-input',
      placeholder: '[0.1, 0.2, 0.3, ...]',
      condition: { field: 'operation', value: 'search_vector' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a JSON array representing a query vector for Pinecone vector search based on the user's description. The array should contain floating-point numbers. Note: For semantic search, you typically generate this from an embedding model, but if you need a sample vector, provide an array of floats. Return ONLY a valid JSON array - no explanations.",
        placeholder: 'Describe the vector or paste embedding values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'topK',
      title: 'Top K Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_vector' },
    },
    {
      id: 'options',
      title: 'Options',
      type: 'checkbox-list',
      options: [
        { id: 'includeValues', label: 'Include Values' },
        { id: 'includeMetadata', label: 'Include Metadata' },
      ],
      condition: { field: 'operation', value: 'search_vector' },
    },
    // Common fields
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Your Pinecone API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'pinecone_generate_embeddings',
      'pinecone_upsert_text',
      'pinecone_search_text',
      'pinecone_search_vector',
      'pinecone_fetch',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        switch (params.operation) {
          case 'generate':
            return 'pinecone_generate_embeddings'
          case 'upsert_text':
            return 'pinecone_upsert_text'
          case 'search_text':
            return 'pinecone_search_text'
          case 'fetch':
            return 'pinecone_fetch'
          case 'search_vector':
            return 'pinecone_search_vector'
          default:
            throw new Error('Invalid operation selected')
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Pinecone API key' },
    indexHost: { type: 'string', description: 'Index host URL' },
    namespace: { type: 'string', description: 'Vector namespace' },
    // Generate embeddings inputs
    model: { type: 'string', description: 'Embedding model' },
    inputs: { type: 'json', description: 'Text inputs' },
    parameters: { type: 'json', description: 'Model parameters' },
    // Upsert text inputs
    records: { type: 'json', description: 'Records to upsert' },
    // Search text inputs
    searchQuery: { type: 'string', description: 'Search query text' },
    topK: { type: 'string', description: 'Top K results' },
    fields: { type: 'json', description: 'Fields to return' },
    filter: { type: 'json', description: 'Search filter' },
    rerank: { type: 'json', description: 'Rerank options' },
    // Fetch inputs
    ids: { type: 'json', description: 'Vector identifiers' },
    vector: { type: 'json', description: 'Query vector' },
    includeValues: { type: 'boolean', description: 'Include vector values' },
    includeMetadata: { type: 'boolean', description: 'Include metadata' },
  },

  outputs: {
    matches: { type: 'json', description: 'Search matches' },
    statusText: { type: 'string', description: 'Status of the upsert operation' },
    data: { type: 'json', description: 'Response data' },
    model: { type: 'string', description: 'Model information' },
    vector_type: { type: 'string', description: 'Vector type' },
    usage: { type: 'json', description: 'Usage statistics' },
  },
}

export const PineconeBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://www.pinecone.io',
  templates: [
    {
      icon: PineconeIcon,
      title: 'Pinecone reindex pipeline',
      prompt:
        'Build a scheduled workflow that regenerates embeddings with OpenAI for new or changed source documents and upserts the vectors into a Pinecone index so retrieval stays current.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone semantic search agent',
      prompt:
        'Create an agent that takes a natural-language query, embeds it with OpenAI, retrieves top-k matches from Pinecone, and answers with cited passages plus a confidence score.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone retrieval-quality monitor',
      prompt:
        'Build a scheduled weekly workflow that runs a fixed set of benchmark queries against a Pinecone index, records top-k similarity scores per namespace to a table, and pings Slack when retrieval quality regresses.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone duplicate detector',
      prompt:
        'Create a workflow that reads a table of candidate records, embeds each with OpenAI, searches a Pinecone index for matches above a similarity threshold, and writes the near-duplicates to a cleanup queue.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone tenant isolation auditor',
      prompt:
        'Build a workflow that verifies Pinecone namespace isolation by sampling cross-namespace queries, ensuring no leakage, and writing a compliance audit report each week.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'enterprise'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone FAQ deflection bot',
      prompt:
        'Create a workflow that embeds an incoming question with OpenAI, searches a Pinecone index of FAQ entries for the closest match, and returns the answer when similarity is high or escalates when it is not.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone support knowledge retriever',
      prompt:
        'Build a workflow that fetches each new Zendesk ticket, embeds the question with OpenAI, queries a Pinecone index of resolved tickets and docs, and drafts a suggested reply citing the most relevant matches for the agent to approve.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'vector-search', 'automation'],
      alsoIntegrations: ['openai', 'zendesk'],
    },
  ],
  skills: [
    {
      name: 'upsert-text-records',
      description:
        'Embed and upsert text records into a Pinecone namespace using integrated embeddings.',
      content:
        '# Upsert Text Records\n\nLoad documents into a Pinecone index for retrieval.\n\n## Steps\n1. Use the Upsert Text operation and provide the Index Host and target Namespace.\n2. Pass newline-delimited JSON Records, each with a unique _id, a text or chunk_text field, and any metadata fields such as category for later filtering.\n3. Keep chunks reasonably sized so each record carries one coherent idea.\n4. Confirm the upsert status from the response.\n\n## Output\nReport how many records were upserted into which namespace and surface any records that failed validation.',
    },
    {
      name: 'semantic-search',
      description:
        'Run a text query against a Pinecone index with metadata filtering and optional reranking.',
      content:
        '# Semantic Search\n\nRetrieve the most relevant records for a query.\n\n## Steps\n1. Use the Search With Text operation with the Index Host, Namespace, and a natural-language Search Query.\n2. Set Top K for how many matches to return and list the Fields to Return.\n3. Optionally apply a metadata Filter (operators like $eq, $in, $gte) to scope the search, and pass Rerank Options to reorder by a cross-encoder for higher precision.\n\n## Output\nThe top matches with their scores, returned fields, and IDs, ordered by relevance after any reranking.',
    },
    {
      name: 'generate-embeddings',
      description:
        'Generate vector embeddings for a set of texts with a Pinecone-hosted embedding model.',
      content:
        '# Generate Embeddings\n\nTurn text into vectors for storage or comparison.\n\n## Steps\n1. Use the Generate Embeddings operation and choose a model such as multilingual-e5-large or llama-text-embed-v2.\n2. Provide the Text Inputs as a JSON array of objects each with a text field.\n3. Use the returned vectors for downstream upserts or similarity work.\n\n## Output\nThe embedding vector per input, the model used, and the usage statistics for cost tracking.',
    },
    {
      name: 'fetch-vectors-by-id',
      description: 'Fetch specific vectors and their metadata from a Pinecone namespace by ID.',
      content:
        '# Fetch Vectors By ID\n\nLook up known records directly.\n\n## Steps\n1. Use the Fetch Vectors operation with the Index Host and Namespace.\n2. Provide the Vector IDs as a JSON array of the records to retrieve.\n3. Inspect the returned values and metadata to confirm content or debug retrieval.\n\n## Output\nThe requested records with their stored metadata, and a note listing any IDs that were not found.',
    },
  ],
} as const satisfies BlockMeta

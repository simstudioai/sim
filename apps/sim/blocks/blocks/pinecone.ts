import { PineconeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { PineconeResponse } from '@/tools/pinecone/types'

export const PineconeBlock: BlockConfig<PineconeResponse> = {
  type: 'pinecone',
  name: 'Pinecone',
  description: 'Use Pinecone vector database',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Pinecone into the workflow. Can generate embeddings, upsert text, search with text, fetch vectors, and search with vectors.',
  docsLink: 'https://docs.sim.ai/tools/pinecone',
  category: 'tools',
  bgColor: '#0D1117',
  icon: PineconeIcon,

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

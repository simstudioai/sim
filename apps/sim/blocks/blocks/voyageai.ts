import { VoyageAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const VoyageAIBlock: BlockConfig = {
  type: 'voyageai',
  name: 'Voyage AI',
  description: 'Generate embeddings and rerank with Voyage AI',
  longDescription:
    'Integrate Voyage AI into the workflow. Generate embeddings from text or rerank documents by relevance.',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.AI,
  tags: ['llm', 'vector-search'],
  bgColor: '#1A1A2E',
  icon: VoyageAIIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Generate Embeddings', id: 'embeddings' },
        { label: 'Rerank', id: 'rerank' },
      ],
      value: () => 'embeddings',
    },
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      placeholder: 'Enter text to generate embeddings for',
      condition: { field: 'operation', value: 'embeddings' },
      required: true,
    },
    {
      id: 'embeddingModel',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'voyage-3-large', id: 'voyage-3-large' },
        { label: 'voyage-3', id: 'voyage-3' },
        { label: 'voyage-3-lite', id: 'voyage-3-lite' },
        { label: 'voyage-code-3', id: 'voyage-code-3' },
        { label: 'voyage-finance-2', id: 'voyage-finance-2' },
        { label: 'voyage-law-2', id: 'voyage-law-2' },
      ],
      condition: { field: 'operation', value: 'embeddings' },
      value: () => 'voyage-3',
    },
    {
      id: 'inputType',
      title: 'Input Type',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Query', id: 'query' },
      ],
      condition: { field: 'operation', value: 'embeddings' },
      value: () => 'document',
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Enter the query to rerank documents against',
      condition: { field: 'operation', value: 'rerank' },
      required: true,
    },
    {
      id: 'documents',
      title: 'Documents',
      type: 'code',
      placeholder: '["document 1 text", "document 2 text", ...]',
      condition: { field: 'operation', value: 'rerank' },
      required: true,
    },
    {
      id: 'rerankModel',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'rerank-2', id: 'rerank-2' },
        { label: 'rerank-2-lite', id: 'rerank-2-lite' },
      ],
      condition: { field: 'operation', value: 'rerank' },
      value: () => 'rerank-2',
    },
    {
      id: 'topK',
      title: 'Top K',
      type: 'short-input',
      placeholder: 'Number of top results (e.g. 10)',
      condition: { field: 'operation', value: 'rerank' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Voyage AI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['voyageai_embeddings', 'voyageai_rerank'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'embeddings':
            return 'voyageai_embeddings'
          case 'rerank':
            return 'voyageai_rerank'
          default:
            throw new Error(`Invalid Voyage AI operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = { apiKey: params.apiKey }
        if (params.operation === 'embeddings') {
          result.input = params.input
          result.model = params.embeddingModel
          if (params.inputType) {
            result.inputType = params.inputType
          }
        } else {
          result.query = params.query
          result.documents =
            typeof params.documents === 'string' ? JSON.parse(params.documents) : params.documents
          result.model = params.rerankModel
          if (params.topK) {
            result.topK = Number(params.topK)
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    input: { type: 'string', description: 'Text to embed' },
    embeddingModel: { type: 'string', description: 'Embedding model' },
    inputType: { type: 'string', description: 'Input type (query or document)' },
    query: { type: 'string', description: 'Rerank query' },
    documents: { type: 'json', description: 'Documents to rerank' },
    rerankModel: { type: 'string', description: 'Rerank model' },
    topK: { type: 'number', description: 'Number of top results' },
    apiKey: { type: 'string', description: 'Voyage AI API key' },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embedding vectors' },
    results: { type: 'json', description: 'Reranked results with scores' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

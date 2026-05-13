import { VoyageAIIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

export const VoyageAIBlock: BlockConfig = {
  type: 'voyageai',
  name: 'Voyage AI',
  description: 'Generate embeddings and rerank with Voyage AI',
  longDescription:
    'Integrate Voyage AI into the workflow. Generate text or multimodal embeddings, or rerank documents by relevance.',
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
        { label: 'Multimodal Embeddings', id: 'multimodal_embeddings' },
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
        { label: 'voyage-4-large', id: 'voyage-4-large' },
        { label: 'voyage-4', id: 'voyage-4' },
        { label: 'voyage-4-lite', id: 'voyage-4-lite' },
        { label: 'voyage-3.5', id: 'voyage-3.5' },
        { label: 'voyage-3.5-lite', id: 'voyage-3.5-lite' },
        { label: 'voyage-3-large', id: 'voyage-3-large' },
        { label: 'voyage-code-3', id: 'voyage-code-3' },
        { label: 'voyage-finance-2', id: 'voyage-finance-2' },
        { label: 'voyage-law-2', id: 'voyage-law-2' },
      ],
      condition: { field: 'operation', value: 'embeddings' },
      value: () => 'voyage-3.5',
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
      id: 'multimodalInput',
      title: 'Text Input',
      type: 'long-input',
      placeholder: 'Enter text to include in multimodal embedding (optional)',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
    },
    {
      id: 'imageFilesUpload',
      title: 'Image Files',
      type: 'file-upload',
      canonicalParamId: 'imageFiles',
      placeholder: 'Upload image files',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'basic',
      multiple: true,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
    },
    {
      id: 'imageFilesRef',
      title: 'Image Files',
      type: 'short-input',
      canonicalParamId: 'imageFiles',
      placeholder: 'Reference image files from previous blocks',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'advanced',
    },
    {
      id: 'imageUrls',
      title: 'Image URLs',
      type: 'long-input',
      placeholder: 'Enter image URLs (one per line or comma-separated)',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'advanced',
    },
    {
      id: 'videoFileUpload',
      title: 'Video File',
      type: 'file-upload',
      canonicalParamId: 'videoFile',
      placeholder: 'Upload a video file (MP4, max 20MB)',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'basic',
      multiple: false,
      acceptedTypes: '.mp4',
    },
    {
      id: 'videoFileRef',
      title: 'Video File',
      type: 'short-input',
      canonicalParamId: 'videoFile',
      placeholder: 'Reference a video file from previous blocks',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'advanced',
    },
    {
      id: 'videoUrl',
      title: 'Video URL',
      type: 'short-input',
      placeholder: 'Enter a video URL',
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      mode: 'advanced',
    },
    {
      id: 'multimodalModel',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'voyage-multimodal-3.5', id: 'voyage-multimodal-3.5' },
        { label: 'voyage-multimodal-3', id: 'voyage-multimodal-3' },
      ],
      condition: { field: 'operation', value: 'multimodal_embeddings' },
      value: () => 'voyage-multimodal-3.5',
    },
    {
      id: 'multimodalInputType',
      title: 'Input Type',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Query', id: 'query' },
      ],
      condition: { field: 'operation', value: 'multimodal_embeddings' },
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
        { label: 'rerank-2.5', id: 'rerank-2.5' },
        { label: 'rerank-2.5-lite', id: 'rerank-2.5-lite' },
        { label: 'rerank-2', id: 'rerank-2' },
        { label: 'rerank-2-lite', id: 'rerank-2-lite' },
      ],
      condition: { field: 'operation', value: 'rerank' },
      value: () => 'rerank-2.5',
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
    access: ['voyageai_embeddings', 'voyageai_multimodal_embeddings', 'voyageai_rerank'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'embeddings':
            return 'voyageai_embeddings'
          case 'multimodal_embeddings':
            return 'voyageai_multimodal_embeddings'
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
        } else if (params.operation === 'multimodal_embeddings') {
          if (params.multimodalInput) {
            result.input = params.multimodalInput
          }
          const imageFiles = normalizeFileInput(params.imageFiles)
          if (imageFiles) {
            result.imageFiles = imageFiles
          }
          if (params.imageUrls) {
            result.imageUrls = params.imageUrls
          }
          const videoFile = normalizeFileInput(params.videoFile, { single: true })
          if (videoFile) {
            result.videoFile = videoFile
          }
          if (params.videoUrl) {
            result.videoUrl = params.videoUrl
          }
          result.model = params.multimodalModel
          if (params.multimodalInputType) {
            result.inputType = params.multimodalInputType
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
    multimodalInput: { type: 'string', description: 'Text for multimodal embedding' },
    imageFiles: { type: 'json', description: 'Image files (UserFile objects)' },
    imageUrls: { type: 'string', description: 'Image URLs' },
    videoFile: { type: 'json', description: 'Video file (UserFile object)' },
    videoUrl: { type: 'string', description: 'Video URL' },
    multimodalModel: { type: 'string', description: 'Multimodal embedding model' },
    multimodalInputType: { type: 'string', description: 'Input type for multimodal' },
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
    usage: { type: 'json', description: 'Token/pixel usage' },
  },
}

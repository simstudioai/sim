import type { ToolConfig } from '@/tools/types'
import type {
  VoyageAIMultimodalEmbeddingsParams,
  VoyageAIMultimodalEmbeddingsResponse,
} from '@/tools/voyageai/types'

export const multimodalEmbeddingsTool: ToolConfig<
  VoyageAIMultimodalEmbeddingsParams,
  VoyageAIMultimodalEmbeddingsResponse
> = {
  id: 'voyageai_multimodal_embeddings',
  name: 'Voyage AI Multimodal Embeddings',
  description:
    'Generate embeddings from text, images, and videos using Voyage AI multimodal models',
  version: '1.0',

  params: {
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text to include in the multimodal input',
    },
    imageFiles: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Image files (UserFile objects) to embed',
    },
    imageUrls: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Image URLs (comma-separated or JSON array)',
    },
    videoFile: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Video file (UserFile object) to embed',
    },
    videoUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Video URL',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Multimodal embedding model to use',
      default: 'voyage-multimodal-3.5',
    },
    inputType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Input type: "query" or "document"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Voyage AI API key',
    },
  },

  request: {
    url: '/api/tools/voyageai/multimodal-embeddings',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      input: params.input,
      imageFiles: params.imageFiles,
      imageUrls: params.imageUrls,
      videoFile: params.videoFile,
      videoUrl: params.videoUrl,
      model: params.model || 'voyage-multimodal-3.5',
      inputType: params.inputType,
      apiKey: params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.output) {
      throw new Error(data.error ?? data.detail ?? `VoyageAI API error: ${response.status}`)
    }
    return {
      success: true,
      output: {
        embeddings: data.output.embeddings,
        model: data.output.model,
        usage: data.output.usage,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Multimodal embeddings results',
      properties: {
        embeddings: { type: 'array', description: 'Array of embedding vectors' },
        model: { type: 'string', description: 'Model used for generating embeddings' },
        usage: {
          type: 'object',
          description: 'Usage information',
          properties: {
            text_tokens: { type: 'number', description: 'Text tokens used' },
            image_pixels: { type: 'number', description: 'Image pixels processed' },
            video_pixels: { type: 'number', description: 'Video pixels processed' },
            total_tokens: { type: 'number', description: 'Total tokens used' },
          },
        },
      },
    },
  },
}

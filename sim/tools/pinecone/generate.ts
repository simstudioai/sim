import { ToolConfig } from '../types'
import { PineconeGenerateEmbeddingsParams, PineconeResponse } from './types'

export const generateEmbeddingsTool: ToolConfig<
  PineconeGenerateEmbeddingsParams,
  PineconeResponse
> = {
  id: 'pinecone_generate_embeddings',
  name: 'Pinecone Generate Embeddings',
  description: "Generate embeddings from text using Pinecone's hosted models",
  version: '1.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Pinecone API key',
    },
    model: {
      type: 'string',
      required: true,
      description: 'Model to use for generating embeddings',
    },
    inputs: {
      type: 'array',
      required: true,
      description: 'Array of text inputs to generate embeddings for',
    },
  },

  request: {
    method: 'POST',
    url: () => 'https://api.pinecone.io/embed',
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => ({
      model: params.model,
      inputs: params.inputs,
      parameters: params.parameters || {
        input_type: 'passage',
        truncate: 'END',
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        data: data.data,
        model: data.model,
        vector_type: data.vector_type,
        usage: data.usage,
      },
    }
  },

  transformError: (error) => `Pinecone embeddings generation failed: ${error.message}`,
}

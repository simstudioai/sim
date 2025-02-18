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
    apiKey: { type: 'string', required: true, description: 'Pinecone API key' },
    environment: { type: 'string', required: true, description: 'Pinecone environment' },
    indexName: { type: 'string', required: true, description: 'Name of the Pinecone index' },
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
    parameters: { type: 'object', required: false, description: 'Additional model parameters' },
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
      parameters: {
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
        embeddings: data.embeddings,
        usage: data.usage,
      },
    }
  },

  transformError: (error) => `Pinecone embeddings generation failed: ${error.message}`,
}

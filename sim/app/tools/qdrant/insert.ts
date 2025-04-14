import { ToolConfig } from '../types'
import { UpsertVectorsParams, QdrantResponse } from './types'

export const upsertVectorsTool: ToolConfig<UpsertVectorsParams, QdrantResponse> = {
  id: 'qdrant_insert',
  name: 'Qdrant Insert Points',
  description: 'Upserts points (vectors) into a Qdrant collection',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'API key for authentication',
    },
    collectionName: {
      type: 'string',
      required: true,
      description: 'The target Qdrant collection name',
    },
    indexHost: {
      type: 'string',
      required: true,
      description: 'The Qdrant index host URL (e.g., https://your-endpoint)',
    },
    vectors: {
      type: 'array',
      required: true,
      description: 'Array of vector objects. Each object should have an id, a vector (number array), and optionally a payload.',
    },
  },

  request: {
    url: (params: UpsertVectorsParams) => `${params.indexHost}/collections/${params.collectionName}/points`,
    method: 'PUT',
    headers: (params: UpsertVectorsParams) => ({
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    }),
    // Process the vectors field. If it's a raw JSON string, parse it.
    // If the parsed object already has a "points" property, return it directly.
    // Otherwise, wrap it into an object with the "points" key.
    body: (params: UpsertVectorsParams) => {
      let parsed;
      try {
        parsed = typeof params.vectors === 'string'
          ? JSON.parse(params.vectors)
          : params.vectors;
      } catch (e) {
        throw new Error("Invalid JSON provided for vectors.");
      }
      
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.points) {
        return parsed;
      }
      return { points: parsed };
    }
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    return {
      success: true,
      output: { inserted: data.result?.insertedCount || data.result?.inserted || 0 },
    }
  },

  transformError: (error) => `Qdrant insert failed: ${error.message}`,
}
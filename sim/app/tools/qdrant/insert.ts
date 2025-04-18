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
    const data = await response.json();
    return {
      success: true,
      output: { inserted: data.result?.insertedCount || data.result?.inserted || 0 },
    }
  },

  transformError: async (error) => {
    try {
      console.error("=== transformError called ===");
      console.error("Received error:", error);
  
      if (error.response) {
        console.error("HTTP Status:", error.response.status);
        try {
          const errorText = await error.response.text();
          console.error("Full Error Response Text:", errorText);
          try {
            const errorJson = JSON.parse(errorText);
            console.error("Parsed Error JSON:", errorJson);
          } catch (jsonParseError) {
            console.error("Failed to parse error response as JSON:", jsonParseError);
          }
          console.error("=== transformError finished ===");
          return errorText || error.message || 'An error occurred while upserting vectors';
        } catch (readError) {
          console.error("Error reading error.response text:", readError);
        }
      }
      console.error("No response property on error. Full error object:", error);
    } catch (e) {
      console.error("Error in transformError itself:", e);
    }
    console.error("=== transformError ended with no detailed logs ===");
    return error.message;
  }
}
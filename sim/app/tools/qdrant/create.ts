import { ToolConfig } from '../types'
import { CreateCollectionParams, QdrantResponse } from './types'

export const createCollectionTool: ToolConfig<CreateCollectionParams, QdrantResponse> = {
  id: 'qdrant_create_collection',
  name: 'Qdrant Create Collection',
  description: 'Creates a new collection in Qdrant',
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
      description: 'The name of the collection to be created',
    },
    indexHost: {
      type: 'string',
      required: true,
      description: 'The Qdrant index host URL (e.g., https://your-endpoint)',
    },
    dimension: {
      type: 'number',
      required: true,
      description: 'Dimension of the vectors (>=1)',
    },
    distance: {
      type: 'dropdown',
      required: true,
      description: 'Distance metric to use',
    },
  },

  request: {
    url: (params: CreateCollectionParams) => `${params.indexHost}/collections/${params.collectionName}`,
    method: 'PUT',
    headers: (params: CreateCollectionParams) => ({
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    }),
    // Convert the dimension value to a number in case it comes in as a string,and log the captured values for debugging.
    body: (params: CreateCollectionParams) => {
      console.log("Creating collection with values:", {
        dimension: params.dimension,
        distance: params.distance,
      });
      return {
        vectors: {
          size: Number(params.dimension),
          distance: params.distance,
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json();
    console.log("Create collection response:", data);
    return {
      success: true,
      output : { result: data.result },
    }
  },

  transformError: async (error) => {
    console.error("=== createCollectionTool transformError called ===");
    if (error.response) {
      console.error("HTTP Status:", error.response.status);
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while creating the collection';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    console.error("Full error object:", error);
    return error.message || 'An error occurred while creating the collection';
  },
}
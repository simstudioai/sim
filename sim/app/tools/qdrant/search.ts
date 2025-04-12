import { ToolConfig } from '../types'
import { QdrantResponse, SearchVectorsParams } from './types'

export const searchVectorsTool: ToolConfig<SearchVectorsParams, QdrantResponse> = {
  id: 'qdrant_search_vectors',
  name: 'Qdrant Search Vectors',
  description: 'Search for similar vectors in a Qdrant collection',
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
      description: 'The name of the Qdrant collection',
    },
    indexHost: {
      type: 'string',
      required: true,
      description: 'The Qdrant index host URL (e.g., https://your-endpoint)',
    },
    searchVector: {
      type: 'json',
      required: true,
      description: 'Enter an array as raw JSON, e.g. [0.2, 0.1, 0.9, 0.7].',
    },
    topK: {
      type: 'number',
      required: true,
      description: 'Maximum number of search results to return',
    },
    filter: {
      type: 'json',
      required: false,
      description:
        'Optional filter conditions as JSON. Example: {"must": [{"key": "city", "match": {"value": "London"}}]}',
    },
  },

  request: {
    url: (params: SearchVectorsParams) =>
      `${params.indexHost}/collections/${params.collectionName}/points/search`,
    method: 'POST',
    headers: (params: SearchVectorsParams) => ({
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    }),
    body: (params: SearchVectorsParams) => {
      let rawVector = params.searchVector;
      console.log("Raw searchVector input:", rawVector);
      let parsedVector;
      try {
        if (typeof rawVector === 'string') {
          rawVector = rawVector.trim();
          parsedVector = JSON.parse(rawVector);
        } else {
          parsedVector = rawVector;
        }
        console.log("Parsed searchVector:", parsedVector);
        if (!Array.isArray(parsedVector)) {
          throw new Error("Search vector must be an array.");
        }
      } catch (e: any) {
        throw new Error("Invalid JSON provided for search vector: " + e.message);
      }

      // Process topK
      let limitValue = Number(params.topK);
      if (isNaN(limitValue) || limitValue < 1) {
        throw new Error("Top K Results must be a valid number (>= 1).");
      }

      // Process filter
      let filterValue;
      if (params.filter) {
        try {
          if (typeof params.filter === 'string') {
            filterValue = JSON.parse(params.filter.trim());
          } else {
            filterValue = params.filter;
          }
          if (typeof filterValue !== 'object' || Array.isArray(filterValue)) {
            throw new Error("Filter must be a JSON object.");
          }
        } catch (e: any) {
          throw new Error("Invalid JSON provided for filter: " + e.message);
        }
      }

      const payload: Record<string, any> = {
        vector: parsedVector,
        limit: limitValue || 10,
      };
      if (filterValue !== undefined) {
        payload.filter = filterValue;
      }
      console.log("Final search payload:", JSON.stringify(payload, null, 2));
      return payload;
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json();
    console.log("Search response data:", data);
    return {
      success: true,
      output: { results: data.result || [] },
    };
  },

  transformError: async (error) => {
    console.error("=== searchVectorsTool transformError called ===");
    if (error.response) {
      console.error("HTTP Status:", error.response.status);
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while searching vectors';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    console.error("Full error object:", error);
    return error.message || 'An error occurred while searching vectors';
  },
}
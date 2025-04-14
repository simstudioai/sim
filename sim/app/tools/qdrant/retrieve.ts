import { ToolConfig } from '../types'
import { RetrieveVectorsParams, QdrantResponse } from './types'

export const retrieveVectorsTool: ToolConfig<RetrieveVectorsParams, QdrantResponse> = {
  id: 'qdrant_retrieve_vectors',
  name: 'Qdrant Retrieve Vectors',
  description: 'Retrieves specific vectors by IDs from a Qdrant collection',
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
    ids: {
      type: 'array',
      required: true,
      description: 'Array of point IDs to retrieve',
    },
  },

  request: {
    url: (params: RetrieveVectorsParams) => `${params.indexHost}/collections/${params.collectionName}/points`,
    method: 'POST',
    headers: (params: RetrieveVectorsParams) => ({
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    }),
    body: (params: RetrieveVectorsParams) => {
      // Process the IDs input in case it's sent as a raw JSON string.
      let ids;
      try {
        if (typeof params.ids === 'string') {
          ids = JSON.parse(params.ids);
        } else {
          ids = params.ids;
        }
        if (!Array.isArray(ids)) {
          throw new Error("ids must be an array");
        }
      } catch (e: any) {
        throw new Error("Invalid JSON provided for ids: " + e.message);
      }
      console.log("Final retrieve payload:", JSON.stringify({ ids }, null, 2));
      return { ids };
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    console.log("Retrieve response data:", data);
    return {
      success: true,
      output: { vectors: data.result || [] },
    };
  },

  transformError: (error) => `Qdrant fetch failed: ${error.message}`,
}
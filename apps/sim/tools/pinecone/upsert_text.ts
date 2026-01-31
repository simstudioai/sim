import type {
  PineconeResponse,
  PineconeUpsertTextParams,
  PineconeUpsertTextRecord,
} from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

export const upsertTextTool: ToolConfig<PineconeUpsertTextParams, PineconeResponse> = {
  id: 'pinecone_upsert_text',
  name: 'Pinecone Upsert Text',
  description: 'Insert or update text records in a Pinecone index',
  version: '1.0',

  params: {
    indexHost: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full Pinecone index host URL (e.g., "https://my-index-abc123.svc.pinecone.io")',
    },
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Namespace to upsert records into (e.g., "documents", "embeddings")',
    },
    records: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Record or array of records to upsert, each containing _id, text, and optional metadata',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Pinecone API key',
    },
  },

  request: {
    method: 'POST',
    url: (params) => `${params.indexHost}/records/namespaces/${params.namespace}/upsert`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/x-ndjson',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => {
      // If records is a string, parse it line by line
      let records: PineconeUpsertTextRecord[]
      if (typeof params.records === 'string') {
        // Split by newlines and parse each line
        records = (params.records as string)
          .split('\n')
          .filter((line: string) => line.trim()) // Remove empty lines
          .map((line: string) => {
            // Clean and parse each line
            const cleanJson = line.trim().replace(/'\\''/g, "'")
            return JSON.parse(cleanJson) as PineconeUpsertTextRecord
          })
      } else {
        records = Array.isArray(params.records) ? params.records : [params.records]
      }

      // Convert to NDJSON format
      const ndjson = records.map((r: PineconeUpsertTextRecord) => JSON.stringify(r)).join('\n')
      return { body: ndjson }
    },
  },

  transformResponse: async (response) => {
    // Pinecone upsert returns 201 Created with empty body on success
    return {
      success: response.status === 201,
      output: {
        statusText: response.status === 201 ? 'Created' : response.statusText,
      },
    }
  },

  outputs: {
    statusText: {
      type: 'string',
      description: 'Status of the upsert operation',
    },
  },
}

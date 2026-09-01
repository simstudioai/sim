import type {
  PineconeResponse,
  PineconeUpsertTextParams,
  PineconeUpsertTextRecord,
} from '@/tools/pinecone/types'
import type { ToolConfig } from '@/tools/types'

function parseUpsertTextRecords(
  input: PineconeUpsertTextParams['records']
): PineconeUpsertTextRecord[] {
  if (typeof input !== 'string') return Array.isArray(input) ? input : [input]

  return input
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line.trim().replace(/'\\''/g, "'")) as PineconeUpsertTextRecord)
}

function rebuildUpsertTextRecords(
  original: PineconeUpsertTextParams['records'],
  projectedChunkText: unknown
): PineconeUpsertTextParams['records'] {
  const records = parseUpsertTextRecords(original)
  if (
    !Array.isArray(projectedChunkText) ||
    projectedChunkText.length !== records.length ||
    projectedChunkText.some((value) => typeof value !== 'string')
  ) {
    throw new Error('Projected Pinecone records do not match the original records')
  }

  const rebuilt = records.map((record, index) => ({
    ...record,
    chunk_text: projectedChunkText[index] as string,
  }))
  if (typeof original === 'string')
    return rebuilt.map((record) => JSON.stringify(record)).join('\n')
  if (Array.isArray(original)) return rebuilt
  if (rebuilt.length !== 1) throw new Error('Expected one Pinecone record')
  return rebuilt[0]
}

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
    modelInput: {
      mode: 'project',
      select: (params) => ({
        records: parseUpsertTextRecords(params.records).map((record) => record.chunk_text),
      }),
      applyProjected: (selectedParams, projectedSelection) => {
        if (selectedParams.records === undefined) {
          throw new Error('Pinecone records are required')
        }
        return {
          records: rebuildUpsertTextRecords(selectedParams.records, projectedSelection.records),
        }
      },
    },
    method: 'POST',
    url: (params) => `${params.indexHost}/records/namespaces/${params.namespace}/upsert`,
    headers: (params) => ({
      'Api-Key': params.apiKey,
      'Content-Type': 'application/x-ndjson',
      'X-Pinecone-API-Version': '2025-01',
    }),
    body: (params) => {
      const records = parseUpsertTextRecords(params.records)
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

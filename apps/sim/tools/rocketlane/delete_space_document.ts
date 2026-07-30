import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteSpaceDocumentParams,
  type RocketlaneDeleteSpaceDocumentResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteSpaceDocumentTool: ToolConfig<
  RocketlaneDeleteSpaceDocumentParams,
  RocketlaneDeleteSpaceDocumentResponse
> = {
  id: 'rocketlane_delete_space_document',
  name: 'Rocketlane Delete Space Document',
  description: 'Permanently delete a Rocketlane space document by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    spaceDocumentId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the space document to delete',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/space-documents/${encodeURIComponent(params.spaceDocumentId)}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteSpaceDocumentParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, spaceDocumentId: params?.spaceDocumentId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the space document was deleted' },
    spaceDocumentId: {
      type: 'number',
      description: 'ID of the deleted space document',
      optional: true,
    },
  },
}

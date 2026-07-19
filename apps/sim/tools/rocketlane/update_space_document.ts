import {
  mapSpaceDocument,
  ROCKETLANE_API_BASE,
  type RocketlaneSpaceDocumentResponse,
  type RocketlaneUpdateSpaceDocumentParams,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_DOCUMENT_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneUpdateSpaceDocumentTool: ToolConfig<
  RocketlaneUpdateSpaceDocumentParams,
  RocketlaneSpaceDocumentResponse
> = {
  id: 'rocketlane_update_space_document',
  name: 'Rocketlane Update Space Document',
  description: 'Update a Rocketlane space document by its ID',
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
      description: 'ID of the space document to update',
    },
    spaceDocumentName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the space document',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New URL to embed in the space document (for embedded documents)',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/space-documents/${encodeURIComponent(params.spaceDocumentId)}`,
    method: 'PUT',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.spaceDocumentName != null) body.spaceDocumentName = params.spaceDocumentName
      if (params.url != null) body.url = params.url
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { spaceDocument: mapSpaceDocument(data) },
    }
  },

  outputs: {
    spaceDocument: {
      type: 'object',
      description: 'The updated space document',
      properties: SPACE_DOCUMENT_OUTPUT_PROPERTIES,
    },
  },
}

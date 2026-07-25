import {
  mapSpaceDocument,
  ROCKETLANE_API_BASE,
  type RocketlaneGetSpaceDocumentParams,
  type RocketlaneSpaceDocumentResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_DOCUMENT_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetSpaceDocumentTool: ToolConfig<
  RocketlaneGetSpaceDocumentParams,
  RocketlaneSpaceDocumentResponse
> = {
  id: 'rocketlane_get_space_document',
  name: 'Rocketlane Get Space Document',
  description: 'Retrieve a Rocketlane space document by its ID',
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
      description: 'ID of the space document to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/space-documents/${encodeURIComponent(params.spaceDocumentId)}`,
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
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
      description: 'The requested space document',
      properties: SPACE_DOCUMENT_OUTPUT_PROPERTIES,
    },
  },
}

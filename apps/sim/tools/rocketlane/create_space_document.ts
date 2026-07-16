import {
  mapSpaceDocument,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateSpaceDocumentParams,
  type RocketlaneSpaceDocumentResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_DOCUMENT_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateSpaceDocumentTool: ToolConfig<
  RocketlaneCreateSpaceDocumentParams,
  RocketlaneSpaceDocumentResponse
> = {
  id: 'rocketlane_create_space_document',
  name: 'Rocketlane Create Space Document',
  description: 'Create a new space document in a Rocketlane space',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    spaceId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the space the document belongs to',
    },
    spaceDocumentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of the space document: ROCKETLANE_DOCUMENT or EMBEDDED_DOCUMENT',
    },
    spaceDocumentName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the space document (defaults to Untitled)',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to embed in the space document (for embedded documents)',
    },
    templateId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the document template to create the document from',
    },
  },

  request: {
    url: () => `${ROCKETLANE_API_BASE}/space-documents`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        space: { spaceId: params.spaceId },
        spaceDocumentType: params.spaceDocumentType,
      }
      if (params.spaceDocumentName != null) body.spaceDocumentName = params.spaceDocumentName
      if (params.url != null) body.url = params.url
      if (params.templateId != null) body.source = { templateId: params.templateId }
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
      description: 'The created space document',
      properties: SPACE_DOCUMENT_OUTPUT_PROPERTIES,
    },
  },
}

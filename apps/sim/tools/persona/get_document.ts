import type { PersonaDocumentResponse, PersonaGetDocumentParams } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  DOCUMENT_OUTPUT_PROPERTIES,
  mapDocument,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetDocumentTool: ToolConfig<PersonaGetDocumentParams, PersonaDocumentResponse> =
  {
    id: 'persona_get_document',
    name: 'Persona Get Document',
    description:
      'Retrieve a single document by ID (government ID, generic document, and more), including its processing status and uploaded files.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Persona API key',
      },
      documentId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Document ID to retrieve (starts with doc_)',
      },
    },

    request: {
      url: (params) =>
        `${PERSONA_API_BASE}/documents/${encodeURIComponent(params.documentId.trim())}`,
      method: 'GET',
      headers: (params) => buildPersonaHeaders(params.apiKey),
    },

    transformResponse: async (response) => {
      const data = await parsePersonaResponse(response)
      return {
        success: true,
        output: {
          document: mapDocument(asResource(data.data)),
        },
      }
    },

    outputs: {
      document: {
        type: 'object',
        description: 'The retrieved document',
        properties: DOCUMENT_OUTPUT_PROPERTIES,
      },
    },
  }

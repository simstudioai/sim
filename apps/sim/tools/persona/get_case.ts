import type { PersonaCaseResponse, PersonaGetCaseParams } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  CASE_OUTPUT_PROPERTIES,
  mapCase,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetCaseTool: ToolConfig<PersonaGetCaseParams, PersonaCaseResponse> = {
  id: 'persona_get_case',
  name: 'Persona Get Case',
  description:
    'Retrieve a single manual review case by ID, including its status, resolution, and assignee.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    caseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Case ID to retrieve (starts with case_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/cases/${encodeURIComponent(params.caseId.trim())}`,
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    return {
      success: true,
      output: {
        case: mapCase(asResource(data.data)),
      },
    }
  },

  outputs: {
    case: {
      type: 'object',
      description: 'The retrieved case',
      properties: CASE_OUTPUT_PROPERTIES,
    },
  },
}

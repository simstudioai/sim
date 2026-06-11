import type { PersonaGetInquiryParams, PersonaInquiryResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetInquiryTool: ToolConfig<PersonaGetInquiryParams, PersonaInquiryResponse> = {
  id: 'persona_get_inquiry',
  name: 'Persona Get Inquiry',
  description:
    'Retrieve a single identity verification inquiry by ID, including its status, collected fields, and decision timestamps.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    inquiryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inquiry ID to retrieve (starts with inq_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}`,
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    return {
      success: true,
      output: {
        inquiry: mapInquiry(asResource(data.data)),
      },
    }
  },

  outputs: {
    inquiry: {
      type: 'object',
      description: 'The retrieved inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

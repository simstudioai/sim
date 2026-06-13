import type { PersonaInquiryResponse, PersonaRedactInquiryParams } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaRedactInquiryTool: ToolConfig<
  PersonaRedactInquiryParams,
  PersonaInquiryResponse
> = {
  id: 'persona_redact_inquiry',
  name: 'Persona Redact Inquiry',
  description:
    'Permanently delete all personally identifiable information collected by an inquiry, for example to honor a data deletion request. This cannot be undone.',
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
      description: 'Inquiry ID to redact (starts with inq_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}`,
    method: 'DELETE',
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
      description: 'The redacted inquiry (PII fields are removed)',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

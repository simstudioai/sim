import type { PersonaDeclineInquiryParams, PersonaInquiryResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaDeclineInquiryTool: ToolConfig<
  PersonaDeclineInquiryParams,
  PersonaInquiryResponse
> = {
  id: 'persona_decline_inquiry',
  name: 'Persona Decline Inquiry',
  description:
    'Decline an identity verification inquiry. Declining prevents further progress on the inquiry and triggers any associated workflows and webhooks.',
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
      description: 'Inquiry ID to decline (starts with inq_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/decline`,
    method: 'POST',
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
      description: 'The declined inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

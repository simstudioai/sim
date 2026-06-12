import type { PersonaApproveInquiryParams, PersonaInquiryResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaApproveInquiryTool: ToolConfig<
  PersonaApproveInquiryParams,
  PersonaInquiryResponse
> = {
  id: 'persona_approve_inquiry',
  name: 'Persona Approve Inquiry',
  description:
    'Approve an identity verification inquiry. Approving prevents further progress on the inquiry and triggers any associated workflows and webhooks.',
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
      description: 'Inquiry ID to approve (starts with inq_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/approve`,
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
      description: 'The approved inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

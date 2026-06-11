import type {
  PersonaInquiryResponse,
  PersonaMarkInquiryForReviewParams,
} from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaMarkInquiryForReviewTool: ToolConfig<
  PersonaMarkInquiryForReviewParams,
  PersonaInquiryResponse
> = {
  id: 'persona_mark_inquiry_for_review',
  name: 'Persona Mark Inquiry for Review',
  description:
    'Mark an identity verification inquiry for manual review, moving it to the needs_review status.',
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
      description: 'Inquiry ID to mark for review (starts with inq_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/mark-for-review`,
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
      description: 'The inquiry marked for review',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

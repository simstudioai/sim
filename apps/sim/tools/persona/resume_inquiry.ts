import type {
  PersonaResumeInquiryParams,
  PersonaResumeInquiryResponse,
} from '@/tools/persona/types'
import {
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaResumeInquiryTool: ToolConfig<
  PersonaResumeInquiryParams,
  PersonaResumeInquiryResponse
> = {
  id: 'persona_resume_inquiry',
  name: 'Persona Resume Inquiry',
  description:
    'Resume a pending or expired inquiry, creating a new session so the individual can continue verification. Returns a session token.',
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
      description: 'Inquiry ID to resume (starts with inq_)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/resume`,
    method: 'POST',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        inquiry: mapInquiry(data.data ?? {}),
        sessionToken: data.meta?.['session-token'] ?? null,
      },
    }
  },

  outputs: {
    inquiry: {
      type: 'object',
      description: 'The resumed inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
    sessionToken: {
      type: 'string',
      description:
        'Session token for the new inquiry session, used to continue the flow in embedded SDKs',
      optional: true,
    },
  },
}

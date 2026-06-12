import type {
  PersonaGenerateInquiryLinkParams,
  PersonaGenerateInquiryLinkResponse,
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

export const personaGenerateInquiryLinkTool: ToolConfig<
  PersonaGenerateInquiryLinkParams,
  PersonaGenerateInquiryLinkResponse
> = {
  id: 'persona_generate_inquiry_link',
  name: 'Persona Generate Inquiry Link',
  description:
    'Generate a one-time link for an inquiry that the individual can open to complete their identity verification.',
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
      description: 'Inquiry ID to generate a one-time link for (starts with inq_)',
    },
    expiresInSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of seconds from now until the link expires (must be greater than 0; defaults to the inquiry template setting, typically 24 hours)',
    },
  },

  request: {
    url: (params) =>
      `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}/generate-one-time-link`,
    method: 'POST',
    headers: (params) => buildPersonaHeaders(params.apiKey),
    body: (params) => {
      if (params.expiresInSeconds === undefined || params.expiresInSeconds === null) {
        return {}
      }
      const expiresInSeconds = Number(params.expiresInSeconds)
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new Error('Link expiry must be a positive whole number of seconds')
      }
      return { meta: { 'expires-in-seconds': expiresInSeconds } }
    },
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    const oneTimeLink = data.meta?.['one-time-link']
    const oneTimeLinkShort = data.meta?.['one-time-link-short']
    if (typeof oneTimeLink !== 'string' || oneTimeLink.length === 0) {
      throw new Error(
        'Persona did not return a one-time link; check the inquiry status and template settings'
      )
    }
    return {
      success: true,
      output: {
        inquiry: mapInquiry(asResource(data.data)),
        oneTimeLink,
        oneTimeLinkShort:
          typeof oneTimeLinkShort === 'string' && oneTimeLinkShort.length > 0
            ? oneTimeLinkShort
            : oneTimeLink,
      },
    }
  },

  outputs: {
    inquiry: {
      type: 'object',
      description: 'The inquiry the link was generated for',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
    oneTimeLink: {
      type: 'string',
      description: 'One-time link the individual can open to complete the inquiry',
    },
    oneTimeLinkShort: {
      type: 'string',
      description: 'Shortened version of the one-time link',
    },
  },
}

import type { PersonaInquiryResponse, PersonaUpdateInquiryParams } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parseJsonObjectParam,
  parsePersonaResponse,
  parseStringArrayParam,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaUpdateInquiryTool: ToolConfig<
  PersonaUpdateInquiryParams,
  PersonaInquiryResponse
> = {
  id: 'persona_update_inquiry',
  name: 'Persona Update Inquiry',
  description:
    'Update an inquiry’s note, fields, tags, or redirect URI. Only the provided values are changed.',
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
      description: 'Inquiry ID to update (starts with inq_)',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form note to set on the inquiry',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of field name to field value pairs to set, as defined by the inquiry template (e.g. {"name-first": "Jane"})',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tag names to set on the inquiry (e.g. ["vip"])',
    },
    redirectUri: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URI to redirect the individual to after completing the inquiry flow',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/inquiries/${encodeURIComponent(params.inquiryId.trim())}`,
    method: 'PATCH',
    headers: (params) => buildPersonaHeaders(params.apiKey),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.note?.trim()) {
        attributes.note = params.note.trim()
      }
      const fields = parseJsonObjectParam(params.fields, 'Fields')
      if (fields) {
        attributes.fields = fields
      }
      const tags = parseStringArrayParam(params.tags, 'Tags')
      if (tags) {
        attributes.tags = tags
      }
      if (params.redirectUri?.trim()) {
        attributes['redirect-uri'] = params.redirectUri.trim()
      }
      if (Object.keys(attributes).length === 0) {
        throw new Error('Provide at least one of note, fields, tags, or redirectUri to update')
      }
      return { data: { attributes } }
    },
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
      description: 'The updated inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

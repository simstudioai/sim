import type { PersonaCreateInquiryParams, PersonaInquiryResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  INQUIRY_OUTPUT_PROPERTIES,
  mapInquiry,
  PERSONA_API_BASE,
  parseJsonObjectParam,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaCreateInquiryTool: ToolConfig<
  PersonaCreateInquiryParams,
  PersonaInquiryResponse
> = {
  id: 'persona_create_inquiry',
  name: 'Persona Create Inquiry',
  description:
    'Create a new identity verification inquiry from an inquiry template. Returns the created inquiry, which can then be completed by the individual via a one-time link.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    inquiryTemplateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Inquiry template ID (starts with itmpl_), inquiry template version ID (starts with itmplv_), or legacy template ID (starts with tmpl_)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID (starts with act_) to associate with this inquiry',
    },
    referenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reference ID that refers to an entity in your user model. An account is auto-created for it if one does not exist.',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of field name to field value pairs to pre-fill, as defined by the inquiry template (e.g. {"name-first": "Jane"})',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form note to attach to the inquiry',
    },
    redirectUri: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'URI to redirect the individual to after completing the inquiry flow',
    },
  },

  request: {
    url: `${PERSONA_API_BASE}/inquiries`,
    method: 'POST',
    headers: (params) => buildPersonaHeaders(params.apiKey),
    body: (params) => {
      const templateId = params.inquiryTemplateId?.trim()
      if (!templateId) {
        throw new Error('Inquiry template ID is required')
      }

      const attributes: Record<string, unknown> = {}
      if (templateId.startsWith('itmplv_')) {
        attributes['inquiry-template-version-id'] = templateId
      } else if (templateId.startsWith('itmpl_')) {
        attributes['inquiry-template-id'] = templateId
      } else if (templateId.startsWith('tmpl_')) {
        attributes['template-id'] = templateId
      } else {
        throw new Error('Inquiry template ID must start with itmpl_, itmplv_, or tmpl_')
      }

      if (params.accountId?.trim()) {
        attributes['account-id'] = params.accountId.trim()
      }
      const fields = parseJsonObjectParam(params.fields, 'Fields')
      if (fields) {
        attributes.fields = fields
      }
      if (params.note?.trim()) {
        attributes.note = params.note.trim()
      }
      if (params.redirectUri?.trim()) {
        attributes['redirect-uri'] = params.redirectUri.trim()
      }

      const body: Record<string, unknown> = { data: { attributes } }
      if (params.referenceId?.trim()) {
        body.meta = { 'auto-create-account-reference-id': params.referenceId.trim() }
      }
      return body
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
      description: 'The created inquiry',
      properties: INQUIRY_OUTPUT_PROPERTIES,
    },
  },
}

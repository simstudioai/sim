import type { PersonaAccountResponse, PersonaUpdateAccountParams } from '@/tools/persona/types'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  asResource,
  buildPersonaHeaders,
  mapAccount,
  PERSONA_API_BASE,
  parseJsonObjectParam,
  parsePersonaResponse,
  parseStringArrayParam,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaUpdateAccountTool: ToolConfig<
  PersonaUpdateAccountParams,
  PersonaAccountResponse
> = {
  id: 'persona_update_account',
  name: 'Persona Update Account',
  description:
    'Update an account’s reference ID, country code, fields, or tags. Only the provided values are changed.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID to update (starts with act_)',
    },
    referenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference ID that refers to an entity in your user model',
    },
    countryCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 3166-1 alpha-2 country code (e.g. US)',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of field name to field value pairs to set, as defined by the account type (e.g. {"name-first": "Jane"})',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tag names to set on the account (e.g. ["vip"])',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/accounts/${encodeURIComponent(params.accountId.trim())}`,
    method: 'PATCH',
    headers: (params) => buildPersonaHeaders(params.apiKey),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.referenceId?.trim()) {
        attributes['reference-id'] = params.referenceId.trim()
      }
      if (params.countryCode?.trim()) {
        attributes['country-code'] = params.countryCode.trim()
      }
      const fields = parseJsonObjectParam(params.fields, 'Fields')
      if (fields) {
        attributes.fields = fields
      }
      const tags = parseStringArrayParam(params.tags, 'Tags')
      if (tags) {
        attributes.tags = tags
      }
      if (Object.keys(attributes).length === 0) {
        throw new Error(
          'Provide at least one of referenceId, countryCode, fields, or tags to update'
        )
      }
      return { data: { attributes } }
    },
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    return {
      success: true,
      output: {
        account: mapAccount(asResource(data.data)),
      },
    }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The updated account',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}

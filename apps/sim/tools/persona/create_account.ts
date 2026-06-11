import type { PersonaAccountResponse, PersonaCreateAccountParams } from '@/tools/persona/types'
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

export const personaCreateAccountTool: ToolConfig<
  PersonaCreateAccountParams,
  PersonaAccountResponse
> = {
  id: 'persona_create_account',
  name: 'Persona Create Account',
  description:
    'Create an account that represents an individual in Persona. Accounts consolidate inquiries, verifications, and reports for the same person.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    accountTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Account type ID to create the account for (starts with acttp_); defaults to your organization default',
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
        'JSON object of field name to field value pairs, as defined by the account type (e.g. {"name-first": "Jane"})',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tag names to associate with the account (e.g. ["vip"])',
    },
  },

  request: {
    url: `${PERSONA_API_BASE}/accounts`,
    method: 'POST',
    headers: (params) => buildPersonaHeaders(params.apiKey),
    body: (params) => {
      const attributes: Record<string, unknown> = {}
      if (params.accountTypeId?.trim()) {
        attributes['account-type-id'] = params.accountTypeId.trim()
      }
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
      description: 'The created account',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}

import type { PersonaAccountResponse, PersonaGetAccountParams } from '@/tools/persona/types'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  asResource,
  buildPersonaHeaders,
  mapAccount,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetAccountTool: ToolConfig<PersonaGetAccountParams, PersonaAccountResponse> = {
  id: 'persona_get_account',
  name: 'Persona Get Account',
  description:
    'Retrieve a single account by ID, including its reference ID, fields, tags, and status.',
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
      description: 'Account ID to retrieve (starts with act_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/accounts/${encodeURIComponent(params.accountId.trim())}`,
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
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
      description: 'The retrieved account',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}

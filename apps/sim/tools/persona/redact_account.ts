import type { PersonaAccountResponse, PersonaRedactAccountParams } from '@/tools/persona/types'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  asResource,
  buildPersonaHeaders,
  mapAccount,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaRedactAccountTool: ToolConfig<
  PersonaRedactAccountParams,
  PersonaAccountResponse
> = {
  id: 'persona_redact_account',
  name: 'Persona Redact Account',
  description:
    'Permanently delete all personally identifiable information stored on an account, for example to honor a data deletion request. This cannot be undone.',
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
      description: 'Account ID to redact (starts with act_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/accounts/${encodeURIComponent(params.accountId.trim())}`,
    method: 'DELETE',
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
      description: 'The redacted account (PII fields are removed)',
      properties: ACCOUNT_OUTPUT_PROPERTIES,
    },
  },
}

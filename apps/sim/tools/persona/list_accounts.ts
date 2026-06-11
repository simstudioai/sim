import type { PersonaListAccountsParams, PersonaListAccountsResponse } from '@/tools/persona/types'
import {
  ACCOUNT_OUTPUT_PROPERTIES,
  asResourceList,
  buildPersonaHeaders,
  getNextCursor,
  mapAccount,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaListAccountsTool: ToolConfig<
  PersonaListAccountsParams,
  PersonaListAccountsResponse
> = {
  id: 'persona_list_accounts',
  name: 'Persona List Accounts',
  description:
    'List accounts in your Persona organization, optionally filtered by reference ID. Results are cursor-paginated.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    referenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by reference ID',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of accounts to return per page (1-100, default 10)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: return accounts after this account ID',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.referenceId?.trim()) {
        searchParams.set('filter[reference-id]', params.referenceId.trim())
      }
      if (params.pageSize) searchParams.set('page[size]', String(params.pageSize))
      if (params.pageAfter?.trim()) searchParams.set('page[after]', params.pageAfter.trim())
      const query = searchParams.toString()
      return `${PERSONA_API_BASE}/accounts${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    const accounts = asResourceList(data.data)
    return {
      success: true,
      output: {
        accounts: accounts.map(mapAccount),
        nextCursor: getNextCursor(data.links),
      },
    }
  },

  outputs: {
    accounts: {
      type: 'array',
      description: 'Accounts matching the filters',
      items: {
        type: 'object',
        properties: ACCOUNT_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (pass as pageAfter), or null on the last page',
      optional: true,
    },
  },
}

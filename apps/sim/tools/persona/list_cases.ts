import type { PersonaListCasesParams, PersonaListCasesResponse } from '@/tools/persona/types'
import {
  asResourceList,
  buildPersonaHeaders,
  CASE_OUTPUT_PROPERTIES,
  getNextCursor,
  mapCase,
  PERSONA_API_BASE,
  parsePersonaResponse,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaListCasesTool: ToolConfig<PersonaListCasesParams, PersonaListCasesResponse> = {
  id: 'persona_list_cases',
  name: 'Persona List Cases',
  description:
    'List manual review cases, optionally filtered by status, account ID, or reference ID. Results are cursor-paginated.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by case status (e.g. Open, Resolved)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by account ID (starts with act_)',
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
      description: 'Number of cases to return per page (1-100, default 10)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: return cases after this case ID',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.status?.trim()) searchParams.set('filter[status]', params.status.trim())
      if (params.accountId?.trim()) searchParams.set('filter[account-id]', params.accountId.trim())
      if (params.referenceId?.trim()) {
        searchParams.set('filter[reference-id]', params.referenceId.trim())
      }
      if (params.pageSize) searchParams.set('page[size]', String(params.pageSize))
      if (params.pageAfter?.trim()) searchParams.set('page[after]', params.pageAfter.trim())
      const query = searchParams.toString()
      return `${PERSONA_API_BASE}/cases${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    const cases = asResourceList(data.data)
    return {
      success: true,
      output: {
        cases: cases.map(mapCase),
        nextCursor: getNextCursor(data.links),
      },
    }
  },

  outputs: {
    cases: {
      type: 'array',
      description: 'Cases matching the filters',
      items: {
        type: 'object',
        properties: CASE_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (pass as pageAfter), or null on the last page',
      optional: true,
    },
  },
}

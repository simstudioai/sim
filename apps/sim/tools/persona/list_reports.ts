import type { PersonaListReportsParams, PersonaListReportsResponse } from '@/tools/persona/types'
import {
  asResourceList,
  buildPersonaHeaders,
  getNextCursor,
  mapReport,
  PERSONA_API_BASE,
  parsePersonaResponse,
  REPORT_OUTPUT_PROPERTIES,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaListReportsTool: ToolConfig<
  PersonaListReportsParams,
  PersonaListReportsResponse
> = {
  id: 'persona_list_reports',
  name: 'Persona List Reports',
  description:
    'List screening reports, optionally filtered by account ID or reference ID. Results are cursor-paginated.',
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
      description: 'Number of reports to return per page (1-100, default 10)',
    },
    pageAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: return reports after this report ID',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.accountId?.trim()) searchParams.set('filter[account-id]', params.accountId.trim())
      if (params.referenceId?.trim()) {
        searchParams.set('filter[reference-id]', params.referenceId.trim())
      }
      if (params.pageSize) searchParams.set('page[size]', String(params.pageSize))
      if (params.pageAfter?.trim()) searchParams.set('page[after]', params.pageAfter.trim())
      const query = searchParams.toString()
      return `${PERSONA_API_BASE}/reports${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    const reports = asResourceList(data.data)
    return {
      success: true,
      output: {
        reports: reports.map(mapReport),
        nextCursor: getNextCursor(data.links),
      },
    }
  },

  outputs: {
    reports: {
      type: 'array',
      description: 'Reports matching the filters',
      items: {
        type: 'object',
        properties: REPORT_OUTPUT_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (pass as pageAfter), or null on the last page',
      optional: true,
    },
  },
}

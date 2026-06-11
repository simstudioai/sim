import type { PersonaGetReportParams, PersonaReportResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  mapReport,
  PERSONA_API_BASE,
  parsePersonaResponse,
  REPORT_OUTPUT_PROPERTIES,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

export const personaGetReportTool: ToolConfig<PersonaGetReportParams, PersonaReportResponse> = {
  id: 'persona_get_report',
  name: 'Persona Get Report',
  description:
    'Retrieve a single screening report by ID, including its status, match results, and full type-specific attributes.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Persona API key',
    },
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Report ID to retrieve (starts with rep_)',
    },
  },

  request: {
    url: (params) => `${PERSONA_API_BASE}/reports/${encodeURIComponent(params.reportId.trim())}`,
    method: 'GET',
    headers: (params) => buildPersonaHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parsePersonaResponse(response)
    return {
      success: true,
      output: {
        report: mapReport(asResource(data.data)),
      },
    }
  },

  outputs: {
    report: {
      type: 'object',
      description: 'The retrieved report',
      properties: REPORT_OUTPUT_PROPERTIES,
    },
  },
}

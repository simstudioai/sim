import type { PersonaCreateReportParams, PersonaReportResponse } from '@/tools/persona/types'
import {
  asResource,
  buildPersonaHeaders,
  mapReport,
  PERSONA_API_BASE,
  parsePersonaResponse,
  REPORT_OUTPUT_PROPERTIES,
} from '@/tools/persona/utils'
import type { ToolConfig } from '@/tools/types'

const SUPPORTED_REPORT_TYPES = ['watchlist', 'adverse-media', 'politically-exposed-person'] as const

export const personaCreateReportTool: ToolConfig<PersonaCreateReportParams, PersonaReportResponse> =
  {
    id: 'persona_create_report',
    name: 'Persona Create Report',
    description:
      'Run a screening report (watchlist, adverse media, or politically exposed person) against an individual by name or search term.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Persona API key',
      },
      reportType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Type of report to run: watchlist, adverse-media, or politically-exposed-person',
      },
      reportTemplateId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Report template ID to run (starts with rptp_)',
      },
      term: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Full-name search term (e.g. "Jane Q Doe"). Provide this or the separate name parts.',
      },
      nameFirst: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'First name of the individual to search',
      },
      nameMiddle: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Middle name of the individual to search',
      },
      nameLast: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Last name of the individual to search',
      },
      birthdate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Birthdate of the individual, formatted as YYYY-MM-DD',
      },
      countryCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 3166-1 alpha-2 country code (e.g. US)',
      },
      accountId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Account ID (starts with act_) to associate with this report',
      },
    },

    request: {
      url: `${PERSONA_API_BASE}/reports`,
      method: 'POST',
      headers: (params) => buildPersonaHeaders(params.apiKey),
      body: (params) => {
        const reportType = params.reportType?.trim()
        if (
          !SUPPORTED_REPORT_TYPES.includes(reportType as (typeof SUPPORTED_REPORT_TYPES)[number])
        ) {
          throw new Error(`Report type must be one of: ${SUPPORTED_REPORT_TYPES.join(', ')}`)
        }

        const reportTemplateId = params.reportTemplateId?.trim()
        if (!reportTemplateId) {
          throw new Error('Report template ID is required (starts with rptp_)')
        }

        const query: Record<string, unknown> = {}
        if (params.term?.trim()) query.term = params.term.trim()
        if (params.nameFirst?.trim()) query['name-first'] = params.nameFirst.trim()
        if (params.nameMiddle?.trim()) query['name-middle'] = params.nameMiddle.trim()
        if (params.nameLast?.trim()) query['name-last'] = params.nameLast.trim()
        if (params.birthdate?.trim()) query.birthdate = params.birthdate.trim()
        if (params.countryCode?.trim()) {
          query[reportType === 'watchlist' ? 'country-code' : 'address-country-code'] =
            params.countryCode.trim()
        }

        if (!query.term && !query['name-first'] && !query['name-middle'] && !query['name-last']) {
          throw new Error(
            'At least one of term, nameFirst, nameMiddle, or nameLast is required to run a report'
          )
        }

        const attributes: Record<string, unknown> = {
          'report-template-id': reportTemplateId,
          query,
        }
        if (params.accountId?.trim()) {
          attributes['account-id'] = params.accountId.trim()
        }

        return {
          data: {
            type: `report/${reportType}`,
            attributes,
          },
        }
      },
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
        description: 'The created report. Reports run asynchronously; poll until status is ready.',
        properties: REPORT_OUTPUT_PROPERTIES,
      },
    },
  }

import { normalizeReport, toList } from '@/tools/jotform/normalize'
import type { JotformListReportsParams, JotformListReportsResponse } from '@/tools/jotform/types'
import { buildJotformHeaders, buildJotformUrl, parseJotformResponse } from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listReportsTool: ToolConfig<JotformListReportsParams, JotformListReportsResponse> = {
  id: 'jotform_list_reports',
  name: 'Jotform List Reports',
  description:
    'List every report on the account, across all forms, with the shareable URL for each Excel, CSV, grid, table, calendar, RSS, or visual report.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
  },

  request: {
    url: (params) => buildJotformUrl(params, 'user/reports').toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Reports')

    return {
      success: true,
      output: {
        reports: toList(envelope.content).map(normalizeReport),
      },
    }
  },

  outputs: {
    reports: {
      type: 'array',
      description: 'Reports across every form on the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Report ID' },
          form_id: { type: 'string', description: 'Form the report is built from' },
          title: { type: 'string', description: 'Report title' },
          fields: {
            type: 'string',
            description:
              'Comma-separated fields included in the report: ip, dt (submission date), and question IDs',
          },
          list_type: {
            type: 'string',
            description: 'Report type: excel, csv, grid, table, calendar, rss, or visual',
          },
          status: { type: 'string', description: 'ENABLED or DELETED' },
          url: { type: 'string', description: 'Shareable URL of the report' },
          isProtected: {
            type: 'boolean',
            description: 'True when the report is password protected',
          },
          settings: { type: 'string', description: 'Report display settings, as a JSON string' },
          created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
          updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
        },
      },
    },
  },
}

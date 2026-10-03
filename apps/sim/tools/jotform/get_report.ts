import { normalizeReport, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetReportParams, JotformReportResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getReportTool: ToolConfig<JotformGetReportParams, JotformReportResponse> = {
  id: 'jotform_get_report',
  name: 'Jotform Get Report',
  description: 'Get the details and shareable URL of a single Jotform report.',
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
    reportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the report to read',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `report/${encodeURIComponent(requireValue(params.reportId, 'reportId'))}`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Report')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Get Report returned no report.')

    return {
      success: true,
      output: { report: normalizeReport(raw) },
    }
  },

  outputs: {
    report: {
      type: 'object',
      description: 'The requested report',
      properties: {
        id: { type: 'string', description: 'Report ID' },
        form_id: { type: 'string', description: 'Form the report is built from' },
        title: { type: 'string', description: 'Report title' },
        fields: { type: 'string', description: 'Comma-separated fields included in the report' },
        list_type: {
          type: 'string',
          description: 'Report type: excel, csv, grid, table, calendar, rss, or visual',
        },
        status: { type: 'string', description: 'ENABLED or DELETED' },
        url: { type: 'string', description: 'Shareable URL of the report' },
        isProtected: { type: 'boolean', description: 'True when the report is password protected' },
        settings: { type: 'string', description: 'Report display settings, as a JSON string' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
      },
    },
  },
}

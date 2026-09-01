import { normalizeReport, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformCreateReportParams, JotformReportResponse } from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  requireValue,
  toFormBody,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createReportTool: ToolConfig<JotformCreateReportParams, JotformReportResponse> = {
  id: 'jotform_create_report',
  name: 'Jotform Create Report',
  description:
    'Create a shareable report of a form, choosing the report type and which submission fields it shows.',
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
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the form to build the report from',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the report',
    },
    listType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Report type: excel, csv, grid, table, calendar, rss, or visual',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated fields to include: ip, dt (submission date), and question IDs, e.g. "ip,dt,3,4"',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/reports`
      ).toString(),
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        title: requireValue(params.title, 'title'),
        list_type: requireValue(params.listType, 'listType'),
      }
      const fields = trimOrUndefined(params.fields)
      if (fields) body.fields = fields
      return toFormBody(body)
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Report')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Create Report returned no report.')

    return {
      success: true,
      output: { report: normalizeReport(raw) },
    }
  },

  outputs: {
    report: {
      type: 'object',
      description: 'The created report',
      properties: {
        id: { type: 'string', description: 'Report ID' },
        form_id: { type: 'string', description: 'Form the report is built from' },
        title: { type: 'string', description: 'Report title' },
        fields: { type: 'string', description: 'Comma-separated fields included in the report' },
        list_type: { type: 'string', description: 'Report type that was created' },
        status: { type: 'string', description: 'ENABLED or DELETED' },
        url: { type: 'string', description: 'Shareable URL of the report' },
        isProtected: { type: 'boolean', description: 'True when the report is password protected' },
      },
    },
  },
}

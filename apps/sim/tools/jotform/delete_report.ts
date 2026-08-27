import type { JotformDeleteReportParams, JotformMessageResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteReportTool: ToolConfig<JotformDeleteReportParams, JotformMessageResponse> = {
  id: 'jotform_delete_report',
  name: 'Jotform Delete Report',
  description: 'Delete an existing Jotform report.',
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
      description: 'ID of the report to delete',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `report/${encodeURIComponent(requireValue(params.reportId, 'reportId'))}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Report')

    return {
      success: true,
      output: {
        deleted: true,
        message: toStringOrNull(envelope.content) ?? envelope.message,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'True when Jotform accepted the deletion',
    },
    message: {
      type: 'string',
      description: 'Confirmation text returned by Jotform',
      optional: true,
    },
  },
}

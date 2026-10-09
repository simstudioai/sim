import type { CheckrGetReportEtaResponse, CheckrReportIdParams } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetReportEtaTool: ToolConfig<CheckrReportIdParams, CheckrGetReportEtaResponse> =
  {
    id: 'checkr_get_report_eta',
    name: 'Checkr Get Report ETA',
    description: 'Retrieve the estimated completion date for a report.',
    version: '1.0.0',
    errorExtractor: CHECKR_ERROR_EXTRACTOR,

    params: {
      ...CHECKR_API_KEY_PARAM,
      reportId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the report',
      },
    },

    request: {
      url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/eta`),
      method: 'GET',
      headers: (params) => checkrHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          estimateGeneratedAt: data.estimate_generated_at ?? null,
          estimatedCompletionTime: data.estimated_completion_time ?? null,
        },
      }
    },

    outputs: {
      estimateGeneratedAt: {
        type: 'string',
        description: 'Time the estimate was generated',
        optional: true,
      },
      estimatedCompletionTime: {
        type: 'string',
        description: 'Predicted completion date (only the date is meaningful)',
        optional: true,
      },
    },
  }

import {
  type CheckrListVerificationsResponse,
  type CheckrReportIdParams,
  VERIFICATION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapVerification,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListVerificationsTool: ToolConfig<
  CheckrReportIdParams,
  CheckrListVerificationsResponse
> = {
  id: 'checkr_list_verifications',
  name: 'Checkr List Verifications',
  description:
    'List the verifications on a report, such as requests for the candidate to confirm their SSN or upload an ID.',
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
    url: (params) => checkrUrl(`/reports/${checkrId(params.reportId, 'reportId')}/verifications`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        verifications: (Array.isArray(data.data) ? data.data : []).map(mapVerification),
        count: typeof data.count === 'number' ? data.count : null,
      },
    }
  },

  outputs: {
    verifications: {
      type: 'array',
      description: 'Verifications on the report',
      items: { type: 'object', properties: VERIFICATION_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of verifications', optional: true },
  },
}

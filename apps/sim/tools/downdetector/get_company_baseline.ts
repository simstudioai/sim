import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyBaselineParams,
  type DowndetectorGetCompanyBaselineResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

export const getCompanyBaselineTool: ToolConfig<
  DowndetectorGetCompanyBaselineParams,
  DowndetectorGetCompanyBaselineResponse
> = {
  id: 'downdetector_get_company_baseline',
  name: 'Downdetector Get Company Baseline',
  description:
    'Get the current baseline report value for a Downdetector company. This is the expected average number of reports for the current period, used to judge whether current reports are abnormal.',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) =>
      `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/baseline/current`,
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company baseline'))
    }

    return {
      success: true,
      output: { baseline: typeof data === 'number' ? data : (data?.baseline ?? 0) },
    }
  },

  outputs: {
    baseline: {
      type: 'number',
      description: 'The current baseline (expected average reports) for this period',
    },
  },
}

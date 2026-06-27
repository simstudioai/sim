import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyLast15Params,
  type DowndetectorGetCompanyLast15Response,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

export const getCompanyLast15Tool: ToolConfig<
  DowndetectorGetCompanyLast15Params,
  DowndetectorGetCompanyLast15Response
> = {
  id: 'downdetector_get_company_last_15',
  name: 'Downdetector Get Company Last 15 Minutes',
  description:
    'Get the number of outage reports for a Downdetector company over the last 15 minutes. A convenient near-real-time signal for threshold-based alerting.',
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
      `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/last_15`,
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get last 15 minutes of reports'))
    }

    return {
      success: true,
      output: { count: typeof data === 'number' ? data : (data?.count ?? 0) },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Number of reports over the last 15 minutes',
    },
  },
}

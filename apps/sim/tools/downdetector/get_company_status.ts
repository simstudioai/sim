import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyStatusParams,
  type DowndetectorGetCompanyStatusResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

export const getCompanyStatusTool: ToolConfig<
  DowndetectorGetCompanyStatusParams,
  DowndetectorGetCompanyStatusResponse
> = {
  id: 'downdetector_get_company_status',
  name: 'Downdetector Get Company Status',
  description:
    'Get the current detected status for a Downdetector company. Returns "success" (no problems), "warning", or "danger" (likely outage).',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    threshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If set, returns "danger" when the current report count is above this threshold, otherwise "success"',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/status`
      )
      if (params.threshold !== undefined)
        url.searchParams.set('threshold', String(params.threshold))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company status'))
    }

    return {
      success: true,
      output: { status: typeof data === 'string' ? data : (data?.status ?? '') },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Current status: "success", "warning", or "danger"',
    },
  },
}

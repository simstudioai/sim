import {
  CROWDSTRIKE_CASE_OUTPUT_PROPERTIES,
  CROWDSTRIKE_ERRORS_OUTPUT,
} from '@/tools/crowdstrike/outputs'
import type {
  CrowdStrikeGetCaseDetailsParams,
  CrowdStrikeGetCaseDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetCaseDetailsTool: ToolConfig<
  CrowdStrikeGetCaseDetailsParams,
  CrowdStrikeGetCaseDetailsResponse
> = {
  id: 'crowdstrike_get_case_details',
  name: 'CrowdStrike Get Case Details',
  description:
    'Get CrowdStrike Falcon Case Management case records for one or more case IDs (POST /cases/entities/cases/v2). Requires the "Cases: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    caseIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike case IDs',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      caseIds: params.caseIds,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      operation: 'crowdstrike_get_case_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike case details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    cases: {
      type: 'array',
      description: 'CrowdStrike Case Management case records',
      items: {
        type: 'object',
        properties: CROWDSTRIKE_CASE_OUTPUT_PROPERTIES,
      },
    },
    count: {
      type: 'number',
      description: 'Number of cases returned',
    },
    errors: CROWDSTRIKE_ERRORS_OUTPUT,
  },
}

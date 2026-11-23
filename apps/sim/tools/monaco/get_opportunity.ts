import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
  type MonacoGetOpportunityParams,
  type MonacoOpportunityResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoOpportunity, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetOpportunityTool: ToolConfig<
  MonacoGetOpportunityParams,
  MonacoOpportunityResponse
> = {
  id: 'monaco_get_opportunity',
  name: 'Monaco Get Opportunity',
  description:
    'Get one Monaco opportunity by ID, including its AI-generated summary, identified risks, stage, pipeline, and custom fields.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to fetch',
    },
    includeReasoning: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return each custom field as {value, reasoning, confidence, citations} instead of the bare value. Defaults to false.',
    },
  },

  request: {
    url: (params) => {
      const url = `${MONACO_API_BASE}/v1/opportunities/${safeUrlPathSegment(params.opportunityId, 'opportunityId')}`
      return params.includeReasoning === undefined
        ? url
        : `${url}?include_reasoning=${params.includeReasoning}`
    },
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { opportunity: mapMonacoOpportunity(data.data) } }
  },

  outputs: {
    opportunity: {
      type: 'object',
      description: 'The opportunity',
      properties: MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
    },
  },
}

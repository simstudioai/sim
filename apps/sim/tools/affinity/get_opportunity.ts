import type { AffinityEntityResponse, AffinityGetOpportunityParams } from '@/tools/affinity/types'
import { OPPORTUNITY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetOpportunityTool: ToolConfig<
  AffinityGetOpportunityParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_opportunity',
  name: 'Affinity Get Opportunity',
  description:
    'Read one opportunity and the list it belongs to. Its field data lives on the list entry.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The opportunity ID',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(
        `/opportunities/${encodeURIComponent(requireId(params.opportunityId, 'opportunityId'))}`
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: OPPORTUNITY_OUTPUT_PROPERTIES,
}

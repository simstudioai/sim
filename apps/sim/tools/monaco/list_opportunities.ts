import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_LIST_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_OPPORTUNITY_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListOpportunitiesParams,
  type MonacoListOpportunitiesResponse,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoOpportunity,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListOpportunitiesTool: ToolConfig<
  MonacoListOpportunitiesParams,
  MonacoListOpportunitiesResponse
> = {
  id: 'monaco_list_opportunities',
  name: 'Monaco List Opportunities',
  description:
    'List Monaco opportunities with optional filters, sorting, pagination, and a pipeline scope.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...MONACO_LIST_PARAMS,
    pipelineId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Return only opportunities in this pipeline (see List Pipelines). If omitted, opportunities in every pipeline are returned. Stage keys in a `stage` filter are this pipeline's, or the default pipeline's when omitted; a `stage` filter also takes stage IDs.",
    },
    includeCustomFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Include each opportunity's `custom_field_<id>` values. Defaults to true; set false for leaner responses. Get Opportunity always includes them.",
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/opportunities/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body = buildMonacoListBody(params)
      const pipelineId = params.pipelineId?.trim()
      if (pipelineId) body.pipeline_id = pipelineId
      if (params.includeCustomFields !== undefined) {
        body.include_custom_fields = params.includeCustomFields
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        opportunities: toArray(data.data).map(mapMonacoOpportunity),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    opportunities: {
      type: 'array',
      description: 'Opportunities on this page',
      items: { type: 'object', properties: MONACO_OPPORTUNITY_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}

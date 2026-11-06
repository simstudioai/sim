import type { FlowSearchResult } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowSearchEntitiesParams, FlowSearchEntitiesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  FLOW_SEARCH_RESULT_PROPERTIES,
  flowLimit,
  flowSearchQuery,
  flowUrl,
  mapFlowSearchResult,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowSearchEntitiesTool: ToolConfig<
  FlowSearchEntitiesParams,
  FlowSearchEntitiesResponse
> = {
  id: 'flow_search_entities',
  name: 'Flow Search Entities',
  description:
    'Search live Flow entities by name, supported field values, or exact Flow/Human ID. Returns at most 100 compact matches; fetch entities for full values. Text results may be unavailable while the provider index warms.',
  version: '1.0.0',
  oauth: FLOW_OAUTH,
  params: {
    ...FLOW_AUTH_PARAMS,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project UUID returned by List Projects',
    },
    branchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch ID; omit or use master for Base',
    },
    entityType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to this category ID from Get Data Model',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search names and supported field values, or an exact Flow/Human ID; at most 1024 characters',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results in this page',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/search`,
        {
          query: flowSearchQuery(params.query),
          branch_id: params.branchId?.trim() || undefined,
          entity_type: params.entityType?.trim() || undefined,
          limit: flowLimit(params.limit, 100, 50),
        }
      ),
    method: 'GET',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    retry: {
      enabled: true,
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryIdempotentOnly: true,
    },
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowSearchResult[]
    return { success: true, output: { matches: data.map(mapFlowSearchResult) } }
  },
  outputs: {
    matches: {
      type: 'array',
      items: { type: 'object', properties: FLOW_SEARCH_RESULT_PROPERTIES },
      description: 'Search Entities result',
    },
  },
}

import type { FlowEntityPage } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowListEntitiesParams, FlowListEntitiesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_ENTITY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowLimit,
  flowUrl,
  mapFlowEntity,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowListEntitiesTool: ToolConfig<FlowListEntitiesParams, FlowListEntitiesResponse> = {
  id: 'flow_list_entities',
  name: 'Flow List Entities',
  description:
    'Read one page of live Flow entities. Continue with nextPageStart while moreAvailable is true, including after an empty page.',
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
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque continuation cursor from the previous page',
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
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities`, {
        branch_id: params.branchId?.trim() || undefined,
        entity_type: params.entityType?.trim() || undefined,
        starting_after: params.cursor?.trim() || '0',
        limit: flowLimit(params.limit, 1000, 50),
      }),
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
    const data = (await response.json()) as FlowEntityPage
    if (data.moreAvailable && !data.nextPageStart)
      throw new Error('Flow returned an incomplete page without a continuation cursor')
    return {
      success: true,
      output: {
        entities: data.items.map(mapFlowEntity),
        nextPageStart: data.nextPageStart ?? null,
        moreAvailable: data.moreAvailable ?? false,
      },
    }
  },
  outputs: {
    entities: {
      type: 'array',
      items: { type: 'object', properties: FLOW_ENTITY_PROPERTIES },
      description: 'Entity states on this page',
    },
    nextPageStart: {
      type: 'string',
      nullable: true,
      description: 'Opaque cursor for the next page',
    },
    moreAvailable: { type: 'boolean', description: 'Continue even after empty pages while true' },
  },
}

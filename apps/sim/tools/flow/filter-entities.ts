import { flowHeaders } from '@/lib/flow'
import type { FlowFilterEntitiesParams, FlowFilterEntitiesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowFilter,
  flowLimit,
  flowUrl,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowFilterEntitiesTool: ToolConfig<
  FlowFilterEntitiesParams,
  FlowFilterEntitiesResponse
> = {
  id: 'flow_filter_entities',
  name: 'Flow Filter Entities',
  description:
    'Read one page of IDs matching typed field conditions and AND/OR groups. Continue until nextCursor is null, including after empty pages; results reflect current state.',
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
    filter: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filter object: {kind:"type",operation:"overlaps",values:[categoryId]}, {kind:"field",category_id,field_key,operation:"contains",value}, or {kind:"group",operator:"and"|"or",conditions:[...]}. Use data-model IDs and field-compatible operators; at most 50 nodes and 5 group levels',
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
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA timezone for date filters; defaults to UTC',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/filter/query`
      ),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      filter: flowFilter(params.filter),
      branch_id: params.branchId?.trim() || undefined,
      cursor: params.cursor?.trim() || undefined,
      limit: flowLimit(params.limit, 100, 50),
      timezone: params.timezone?.trim() || undefined,
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as { entity_ids: string[]; next_cursor: string | null }
    return {
      success: true,
      output: { entityIds: data.entity_ids, nextCursor: data.next_cursor ?? null },
    }
  },
  outputs: {
    entityIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Matching entity IDs; fetch entities to read values',
    },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Continue until null, even after an empty page',
    },
  },
}

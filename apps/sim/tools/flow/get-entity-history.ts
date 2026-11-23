import type { FlowHistoryPage } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowGetEntityHistoryParams, FlowGetEntityHistoryResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_HISTORY_ENTRY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowIds,
  flowLimit,
  flowUrl,
  mapFlowHistoryEntry,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowGetEntityHistoryTool: ToolConfig<
  FlowGetEntityHistoryParams,
  FlowGetEntityHistoryResponse
> = {
  id: 'flow_get_entity_history',
  name: 'Flow Get Entity History',
  description:
    'Read a page of change history for up to 500 entities. Keep project, branch, and entity IDs fixed while paging; restart if a rebase expires the cursor.',
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
    entityIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated entity IDs; up to 500 per history page',
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
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/history`
      ),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      entity_ids: flowIds(params.entityIds, 500),
      branch_id: params.branchId?.trim() || undefined,
      cursor: params.cursor?.trim() || undefined,
      limit: flowLimit(params.limit, 100, 100),
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowHistoryPage
    return {
      success: true,
      output: {
        entries: data.items.map(mapFlowHistoryEntry),
        nextCursor: data.next_cursor ?? null,
      },
    }
  },
  outputs: {
    entries: {
      type: 'array',
      items: { type: 'object', properties: FLOW_HISTORY_ENTRY_PROPERTIES },
      description: 'Entity change history page',
    },
    nextCursor: { type: 'string', nullable: true, description: 'Continue until null' },
  },
}

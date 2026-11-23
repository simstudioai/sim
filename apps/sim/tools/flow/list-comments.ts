import type { FlowComment } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowListCommentsParams, FlowListCommentsResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_COMMENT_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  mapFlowComment,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowListCommentsTool: ToolConfig<FlowListCommentsParams, FlowListCommentsResponse> = {
  id: 'flow_list_comments',
  name: 'Flow List Comments',
  description:
    'Read direct comment threads for an entity or direct replies to the original comment ID. Keep the same branch when following replies.',
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
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity ID, or the original comment ID when reading or posting thread replies',
    },
    branchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch ID; omit or use master for Base',
    },
    includeResolved: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include resolved comments',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/comments`,
        {
          branch_id: params.branchId?.trim() || undefined,
          include_resolved: params.includeResolved,
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
    const data = (await response.json()) as FlowComment[]
    return { success: true, output: { comments: data.map(mapFlowComment) } }
  },
  outputs: {
    comments: {
      type: 'array',
      items: { type: 'object', properties: FLOW_COMMENT_PROPERTIES },
      description: 'List Comments result',
    },
  },
}

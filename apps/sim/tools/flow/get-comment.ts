import type { FlowComment } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowGetCommentParams, FlowGetCommentResponse } from '@/tools/flow/types'
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

export const flowGetCommentTool: ToolConfig<FlowGetCommentParams, FlowGetCommentResponse> = {
  id: 'flow_get_comment',
  name: 'Flow Get Comment',
  description: 'Read a comment using its ID and its returned entity_id as the parent path.',
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
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Comment ID; entityId must be the comment's returned entity_id",
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}`
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
    const data = (await response.json()) as FlowComment
    return { success: true, output: { comment: mapFlowComment(data) } }
  },
  outputs: {
    comment: {
      type: 'json',
      properties: FLOW_COMMENT_PROPERTIES,
      description: 'Get Comment result',
    },
  },
}

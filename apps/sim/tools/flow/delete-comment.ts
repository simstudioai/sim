import { flowHeaders } from '@/lib/flow'
import type { FlowDeleteCommentParams, FlowDeleteCommentResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowDeleteCommentTool: ToolConfig<FlowDeleteCommentParams, FlowDeleteCommentResponse> =
  {
    id: 'flow_delete_comment',
    name: 'Flow Delete Comment',
    description: 'Delete a comment authored by the connected user.',
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
      method: 'DELETE',
      headers: flowHeaders,
      redirectPolicy: () => FLOW_REDIRECT_POLICY,
    },
    transformResponse: async (response) => {
      assertFlowResponse(response)
      return { success: true, output: {} }
    },
    outputs: {},
  }

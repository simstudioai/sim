import type { FlowComment } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowUpdateCommentParams, FlowUpdateCommentResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_COMMENT_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowCommentUpdate,
  flowUrl,
  mapFlowComment,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowUpdateCommentTool: ToolConfig<FlowUpdateCommentParams, FlowUpdateCommentResponse> =
  {
    id: 'flow_update_comment',
    name: 'Flow Update Comment',
    description:
      'Edit comment text or resolve/reopen its thread. Use the original comment to change the thread status.',
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
      text: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Replacement plain-text comment body',
      },
      resolved: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Resolve the thread with true or reopen it with false',
      },
    },
    request: {
      url: (params) =>
        flowUrl(
          params,
          `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}`
        ),
      method: 'PATCH',
      headers: flowHeaders,
      redirectPolicy: () => FLOW_REDIRECT_POLICY,
      body: (params) => flowCommentUpdate(params),
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
        description: 'Update Comment result',
      },
    },
  }

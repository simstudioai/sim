import type { FlowComment } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowCreateCommentParams, FlowCreateCommentResponse } from '@/tools/flow/types'
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

export const flowCreateCommentTool: ToolConfig<FlowCreateCommentParams, FlowCreateCommentResponse> =
  {
    id: 'flow_create_comment',
    name: 'Flow Create Comment',
    description:
      'Start a thread on an entity or reply using the original comment ID as entityId. Set the branch explicitly; replies do not inherit it.',
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
      text: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Plain-text comment body',
      },
    },
    request: {
      url: (params) =>
        flowUrl(
          params,
          `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/comments`
        ),
      method: 'POST',
      headers: flowHeaders,
      redirectPolicy: () => FLOW_REDIRECT_POLICY,
      body: (params) => ({ text: params.text, branch_id: params.branchId?.trim() || undefined }),
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
        description: 'Create Comment result',
      },
    },
  }

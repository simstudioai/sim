import {
  BITBUCKET_COMMENT_OUTPUT_PROPERTIES,
  type BitbucketComment,
  type BitbucketCreatePullRequestCommentParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  normalizeBitbucketComment,
} from '@/tools/bitbucket/utils'
import { requireBitbucketPositiveInteger } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketCreatePullRequestCommentTool: ToolConfig<
  BitbucketCreatePullRequestCommentParams,
  BitbucketToolResponse<{ comment: BitbucketComment }>
> = {
  id: 'bitbucket_create_pull_request_comment',
  name: 'Bitbucket Create Pull Request Comment',
  description: 'Create a global comment or reply on a pull request',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Raw comment content',
    },
    parentId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent comment ID when creating a reply',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/comments`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken, { json: true }),
    body: (params) => {
      if (typeof params.content !== 'string' || params.content.trim().length === 0) {
        throw new Error('content must be a non-empty string')
      }
      return {
        content: { raw: params.content },
        ...(params.parentId !== undefined
          ? { parent: { id: requireBitbucketPositiveInteger(params.parentId, 'parentId') } }
          : {}),
      }
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { comment: normalizeBitbucketComment(await bitbucketJson(response)) },
  }),
  outputs: {
    comment: {
      type: 'object',
      description: 'Created comment',
      properties: BITBUCKET_COMMENT_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

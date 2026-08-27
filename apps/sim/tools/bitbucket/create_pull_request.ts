import {
  BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
  type BitbucketCreatePullRequestParams,
  type BitbucketPullRequest,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  normalizeBitbucketPullRequest,
  requireBitbucketString,
} from '@/tools/bitbucket/utils'
import {
  optionalBitbucketBoolean,
  optionalBitbucketStringArray,
} from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketCreatePullRequestTool: ToolConfig<
  BitbucketCreatePullRequestParams,
  BitbucketToolResponse<{ pullRequest: BitbucketPullRequest }>
> = {
  id: 'bitbucket_create_pull_request',
  name: 'Bitbucket Create Pull Request',
  description: 'Create a pull request between repository branches',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest:write'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request title',
    },
    sourceBranch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source branch name',
    },
    destinationBranch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination branch name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pull request description',
    },
    closeSourceBranch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Close the source branch after merge',
    },
    draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create the pull request as a draft',
    },
    reviewerUuids: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket account UUIDs to add as reviewers',
      items: { type: 'string' },
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pullrequests`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken, { json: true }),
    body: (params) => {
      const closeSourceBranch = optionalBitbucketBoolean(
        params.closeSourceBranch,
        'closeSourceBranch'
      )
      const draft = optionalBitbucketBoolean(params.draft, 'draft')
      const reviewerUuids = optionalBitbucketStringArray(
        params.reviewerUuids,
        'reviewerUuids',
        'reviewer UUID'
      )
      return {
        title: requireBitbucketString(params.title, 'title'),
        source: { branch: { name: requireBitbucketString(params.sourceBranch, 'sourceBranch') } },
        destination: {
          branch: { name: requireBitbucketString(params.destinationBranch, 'destinationBranch') },
        },
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(closeSourceBranch !== undefined ? { close_source_branch: closeSourceBranch } : {}),
        ...(draft !== undefined ? { draft } : {}),
        ...(reviewerUuids !== undefined
          ? { reviewers: reviewerUuids.map((uuid) => ({ uuid })) }
          : {}),
      }
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { pullRequest: normalizeBitbucketPullRequest(await bitbucketJson(response)) },
  }),
  outputs: {
    pullRequest: {
      type: 'object',
      description: 'Created pull request',
      properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

import {
  BITBUCKET_BRANCH_OUTPUT_PROPERTIES,
  type BitbucketBranch,
  type BitbucketCreateBranchParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  normalizeBitbucketBranch,
  requireBitbucketString,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketCreateBranchTool: ToolConfig<
  BitbucketCreateBranchParams,
  BitbucketToolResponse<{ branch: BitbucketBranch }>
> = {
  id: 'bitbucket_create_branch',
  name: 'Bitbucket Create Branch',
  description: 'Create a branch at a commit hash or existing ref',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository:write'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New branch name without refs/heads prefix',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full commit hash or existing ref to target',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/refs/branches`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken, { json: true }),
    body: (params) => ({
      name: requireBitbucketString(params.name, 'name'),
      target: { hash: requireBitbucketString(params.target, 'target') },
    }),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { branch: normalizeBitbucketBranch(await bitbucketJson(response)) },
  }),
  outputs: {
    branch: {
      type: 'object',
      description: 'Created branch',
      properties: BITBUCKET_BRANCH_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

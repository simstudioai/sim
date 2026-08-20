import type { BitbucketDeleteBranchParams, BitbucketToolResponse } from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

export const bitbucketDeleteBranchTool: ToolConfig<
  BitbucketDeleteBranchParams,
  BitbucketToolResponse<{ deleted: boolean }>
> = {
  id: 'bitbucket_delete_branch',
  name: 'Bitbucket Delete Branch',
  description: 'Delete a branch from a Bitbucket Cloud repository',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository:write'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch name to delete',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/refs/branches/${encodeBitbucketSegment(params.name, 'name')}`,
    method: 'DELETE',
    headers: (params) => bitbucketHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    if (response.status !== 204) {
      throw new Error(`Bitbucket branch deletion returned unexpected HTTP ${response.status}`)
    }
    return { success: true, output: { deleted: true } }
  },
  outputs: { deleted: { type: 'boolean', description: 'Whether the branch was deleted' } },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

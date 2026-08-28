import {
  BITBUCKET_DIFFSTAT_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketDiffstat,
  type BitbucketListOutput,
  type BitbucketPaginatedPullRequestParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_PULL_REQUEST_PARAMS,
  bitbucketPullRequestPath,
} from '@/tools/bitbucket/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export function pullRequestDiffstatUrl(params: BitbucketPaginatedPullRequestParams): string {
  const url = new URL(
    `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/diffstat`
  )
  return url.toString()
}

export function decodedPathname(url: string): string {
  return new URL(url).pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}

export const bitbucketGetPullRequestDiffstatTool: InternalToolConfig<
  BitbucketPaginatedPullRequestParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketDiffstat>>
> = {
  id: 'bitbucket_get_pull_request_diffstat',
  name: 'Bitbucket Get Pull Request Diffstat',
  description: 'List per-file change statistics for a pull request',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'bitbucket',
    requiredScopes: ['pullrequest', 'repository'],
  },
  params: { ...BITBUCKET_PULL_REQUEST_PARAMS, ...BITBUCKET_PAGINATION_PARAMS },
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Per-file diff statistics',
      items: { type: 'object', properties: BITBUCKET_DIFFSTAT_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

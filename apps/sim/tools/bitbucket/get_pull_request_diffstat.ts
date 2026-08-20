import {
  BITBUCKET_DIFFSTAT_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketDiffstat,
  type BitbucketListOutput,
  type BitbucketPaginatedPullRequestParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_PULL_REQUEST_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPageLength,
  bitbucketPullRequestPath,
  normalizeBitbucketDiffstat,
  normalizeBitbucketPage,
  validateBitbucketPullRequestRedirect,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

function pullRequestDiffstatUrl(params: BitbucketPaginatedPullRequestParams): string {
  const url = new URL(
    `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/diffstat`
  )
  return url.toString()
}

function decodedPathname(url: string): string {
  return new URL(url).pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}

export const bitbucketGetPullRequestDiffstatTool: ToolConfig<
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
  directExecution: async (params, signal) => {
    const {
      resolveBitbucketPullRequestRedirect,
      secureBitbucketPullRequestRedirect,
      secureBitbucketRead,
    } = await import('@/tools/bitbucket/utils.server')
    const initialUrl = pullRequestDiffstatUrl(params)
    const headers = bitbucketHeaders(params.accessToken)
    let response: Response
    if (params.nextUrl !== undefined) {
      const continuation = validateBitbucketPullRequestRedirect(
        params.nextUrl,
        params.workspaceSlug,
        params.repoSlug,
        'diffstat'
      )
      const resolvedTarget = await resolveBitbucketPullRequestRedirect(
        initialUrl,
        params.workspaceSlug,
        params.repoSlug,
        'diffstat',
        headers,
        { signal }
      )
      if (decodedPathname(continuation) !== decodedPathname(resolvedTarget)) {
        throw new Error('nextUrl does not belong to this Bitbucket pull request diffstat')
      }
      response = await secureBitbucketRead(continuation, headers, 2 * 1024 * 1024, {
        maxRedirects: 0,
        signal,
      })
    } else {
      response = await secureBitbucketPullRequestRedirect(
        initialUrl,
        params.workspaceSlug,
        params.repoSlug,
        'diffstat',
        headers,
        2 * 1024 * 1024,
        {
          signal,
          targetQuery: { pagelen: String(bitbucketPageLength(params.pageLen)) },
        }
      )
    }
    await assertBitbucketResponseOk(response)
    return {
      success: true,
      output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketDiffstat),
    }
  },
  request: {
    url: (params) =>
      params.nextUrl
        ? validateBitbucketPullRequestRedirect(
            params.nextUrl,
            params.workspaceSlug,
            params.repoSlug,
            'diffstat'
          )
        : pullRequestDiffstatUrl(params),
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
    stripAuthOnRedirect: true,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketDiffstat),
  }),
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

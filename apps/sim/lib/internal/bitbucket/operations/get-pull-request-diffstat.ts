import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import {
  decodedPathname,
  pullRequestDiffstatUrl,
} from '@/tools/bitbucket/get_pull_request_diffstat'
import type { BitbucketPaginatedPullRequestParams } from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPageLength,
  normalizeBitbucketDiffstat,
  normalizeBitbucketPage,
  validateBitbucketPullRequestRedirect,
} from '@/tools/bitbucket/utils'

export const executeBitbucketGetPullRequestDiffstatOperation: InternalToolOperationImplementation<
  BitbucketPaginatedPullRequestParams
> = async (params, signal) => {
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
}

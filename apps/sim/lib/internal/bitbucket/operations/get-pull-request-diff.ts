import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { pullRequestDiffUrl, transformDiff } from '@/tools/bitbucket/get_pull_request_diff'
import type { BitbucketGetPullRequestDiffParams } from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_RAW_TRANSFER_MAX_BYTES,
  bitbucketHeaders,
  bitbucketHeadRange,
  bitbucketRepositoryPathQuery,
} from '@/tools/bitbucket/utils'

export const executeBitbucketGetPullRequestDiffOperation: InternalToolOperationImplementation<
  BitbucketGetPullRequestDiffParams
> = async (params, signal) => {
  const { secureBitbucketPullRequestRedirect } = await import('@/tools/bitbucket/utils.server')
  const headers = bitbucketHeaders(params.accessToken, {
    json: false,
    range: bitbucketHeadRange(params.maxCharacters),
  })
  const response = await secureBitbucketPullRequestRedirect(
    pullRequestDiffUrl(params),
    params.workspaceSlug,
    params.repoSlug,
    'diff',
    headers,
    BITBUCKET_RAW_TRANSFER_MAX_BYTES,
    {
      signal,
      targetQuery: { path: bitbucketRepositoryPathQuery(params.path), binary: 'false' },
    }
  )
  await assertBitbucketResponseOk(response)
  return transformDiff(response, params.maxCharacters)
}

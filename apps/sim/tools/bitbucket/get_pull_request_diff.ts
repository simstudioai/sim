import type {
  BitbucketGetPullRequestDiffParams,
  BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_MAX_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  BITBUCKET_RAW_TRANSFER_MAX_BYTES,
  BITBUCKET_READ_RETRY,
  bitbucketHeaders,
  bitbucketHeadRange,
  bitbucketPullRequestPath,
  bitbucketRawHead,
  bitbucketRepositoryPathQuery,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

interface BitbucketDiffOutput {
  diff: string
  decodingLossy: boolean
  truncated: boolean
  returnedBytes: number
  fullBytes: number | null
}

function pullRequestDiffUrl(params: BitbucketGetPullRequestDiffParams): string {
  bitbucketRepositoryPathQuery(params.path)
  return `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/diff`
}

async function transformDiff(
  response: Response,
  maxCharacters: number | undefined
): Promise<BitbucketToolResponse<BitbucketDiffOutput>> {
  const raw = await bitbucketRawHead(response, maxCharacters, false, { allowLossyUtf8: true })
  if (raw.binary || raw.content === null) throw new Error('Bitbucket returned a binary diff')
  if (raw.truncated === null) throw new Error('Bitbucket returned an indeterminate diff length')
  return {
    success: true,
    output: {
      diff: raw.content,
      decodingLossy: raw.decodingLossy ?? false,
      truncated: raw.truncated,
      returnedBytes: raw.returnedBytes,
      fullBytes: raw.fullBytes,
    },
  }
}

export const bitbucketGetPullRequestDiffTool: ToolConfig<
  BitbucketGetPullRequestDiffParams,
  BitbucketToolResponse<BitbucketDiffOutput>
> = {
  id: 'bitbucket_get_pull_request_diff',
  name: 'Bitbucket Get Pull Request Diff',
  description: 'Read a bounded UTF-8 unified diff for one pull request file',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'bitbucket',
    requiredScopes: ['pullrequest', 'repository'],
  },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository-relative file path to include in the diff',
    },
    maxCharacters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum diff characters to return (1-500000)',
      default: BITBUCKET_DEFAULT_MAX_CHARACTERS,
    },
  },
  directExecution: async (params, signal) => {
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
  },
  request: {
    url: pullRequestDiffUrl,
    method: 'GET',
    headers: (params) =>
      bitbucketHeaders(params.accessToken, {
        json: false,
        range: bitbucketHeadRange(params.maxCharacters),
      }),
    retry: BITBUCKET_READ_RETRY,
    stripAuthOnRedirect: true,
  },
  transformResponse: async (response, params) => transformDiff(response, params?.maxCharacters),
  outputs: {
    diff: { type: 'string', description: 'Bounded unified diff text decoded as UTF-8' },
    decodingLossy: {
      type: 'boolean',
      description: 'Whether invalid UTF-8 source bytes were replaced while decoding',
    },
    truncated: { type: 'boolean', description: 'Whether later diff text was omitted' },
    returnedBytes: { type: 'number', description: 'Provider bytes read for the returned diff' },
    fullBytes: {
      type: 'number',
      description: 'Full diff byte size when reported',
      nullable: true,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

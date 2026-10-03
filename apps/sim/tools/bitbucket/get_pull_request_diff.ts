import type {
  BitbucketGetPullRequestDiffParams,
  BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_MAX_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  bitbucketPullRequestPath,
  bitbucketRawHead,
  bitbucketRepositoryPathQuery,
} from '@/tools/bitbucket/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

interface BitbucketDiffOutput {
  diff: string
  decodingLossy: boolean
  truncated: boolean
  returnedBytes: number
  fullBytes: number | null
}

export function pullRequestDiffUrl(params: BitbucketGetPullRequestDiffParams): string {
  bitbucketRepositoryPathQuery(params.path)
  return `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/diff`
}

export async function transformDiff(
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

export const bitbucketGetPullRequestDiffTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
  },
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

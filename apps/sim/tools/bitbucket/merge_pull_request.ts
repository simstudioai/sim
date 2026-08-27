import {
  BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
  type BitbucketMergePullRequestParams,
  type BitbucketPullRequest,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  bitbucketRepositoryPathHasPrefix,
  normalizeBitbucketPullRequest,
  validateBitbucketOpaqueUrl,
} from '@/tools/bitbucket/utils'
import {
  optionalBitbucketBoolean,
  optionalBitbucketEnum,
  optionalBitbucketUtf8String,
} from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

const BITBUCKET_MERGE_MESSAGE_MAX_BYTES = 128 * 1024
const BITBUCKET_MERGE_STRATEGIES = [
  'merge_commit',
  'squash',
  'fast_forward',
  'squash_fast_forward',
  'rebase_fast_forward',
  'rebase_merge',
] as const

interface BitbucketMergeOutput {
  status: 'completed' | 'pending'
  taskId: string | null
  taskUrl: string | null
  pullRequest: BitbucketPullRequest | null
}

function mergeTaskLocation(
  response: Response,
  params: BitbucketMergePullRequestParams
): {
  taskId: string
  taskUrl: string
} {
  const rawLocation = response.headers.get('location')
  if (!rawLocation) throw new Error('Bitbucket async merge response omitted the Location header')
  const taskUrl = validateBitbucketOpaqueUrl(
    new URL(rawLocation, `${BITBUCKET_API_BASE}/`).toString()
  )
  const parsed = new URL(taskUrl)
  const expectedPrefix = `/2.0${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/merge/task-status/`
  if (!bitbucketRepositoryPathHasPrefix(parsed.pathname, expectedPrefix)) {
    throw new Error('Bitbucket merge task Location did not match the requested pull request')
  }
  const taskId = decodeURIComponent(parsed.pathname.slice(expectedPrefix.length))
  if (!taskId || taskId.includes('/')) throw new Error('Bitbucket merge task Location was invalid')
  return { taskId, taskUrl }
}

export const bitbucketMergePullRequestTool: ToolConfig<
  BitbucketMergePullRequestParams,
  BitbucketToolResponse<BitbucketMergeOutput>
> = {
  id: 'bitbucket_merge_pull_request',
  name: 'Bitbucket Merge Pull Request',
  description: 'Start an asynchronous pull request merge and return a task to poll when needed',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest:write'] },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    mergeStrategy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Merge strategy: merge_commit, squash, fast_forward, squash_fast_forward, rebase_fast_forward, or rebase_merge',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Merge commit message (maximum 128 KiB encoded as UTF-8)',
    },
    closeSourceBranch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete the source branch after merging',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/merge?async=true`,
    method: 'POST',
    headers: (params) => bitbucketHeaders(params.accessToken, { json: true }),
    body: (params) => {
      const mergeStrategy = optionalBitbucketEnum(
        params.mergeStrategy,
        'mergeStrategy',
        BITBUCKET_MERGE_STRATEGIES
      )
      const message = optionalBitbucketUtf8String(
        params.message,
        'message',
        BITBUCKET_MERGE_MESSAGE_MAX_BYTES
      )
      const closeSourceBranch = optionalBitbucketBoolean(
        params.closeSourceBranch,
        'closeSourceBranch'
      )
      return {
        type: 'pullrequest',
        ...(mergeStrategy !== undefined ? { merge_strategy: mergeStrategy } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(closeSourceBranch !== undefined ? { close_source_branch: closeSourceBranch } : {}),
      }
    },
  },
  transformResponse: async (response, params) => {
    if (response.status === 202) {
      if (!params) throw new Error('Missing merge parameters while reading async merge response')
      const task = mergeTaskLocation(response, params)
      return {
        success: true,
        output: { status: 'pending', ...task, pullRequest: null },
      }
    }
    return {
      success: true,
      output: {
        status: 'completed',
        taskId: null,
        taskUrl: null,
        pullRequest: normalizeBitbucketPullRequest(await bitbucketJson(response)),
      },
    }
  },
  outputs: {
    status: { type: 'string', description: 'Whether the merge completed or remains pending' },
    taskId: { type: 'string', description: 'Async merge task ID', nullable: true },
    taskUrl: { type: 'string', description: 'Validated task polling URL', nullable: true },
    pullRequest: {
      type: 'object',
      description: 'Merged pull request when completed synchronously',
      nullable: true,
      properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

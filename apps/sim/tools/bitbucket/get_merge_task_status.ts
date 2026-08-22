import {
  BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
  type BitbucketGetMergeTaskStatusParams,
  type BitbucketPullRequest,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PULL_REQUEST_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketPullRequestPath,
  encodeBitbucketSegment,
  normalizeBitbucketPullRequest,
} from '@/tools/bitbucket/utils'
import type { ToolConfig } from '@/tools/types'

interface BitbucketMergeTaskOutput {
  taskStatus: 'PENDING' | 'SUCCESS'
  selfUrl: string | null
  mergeResult: BitbucketPullRequest | null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export const bitbucketGetMergeTaskStatusTool: ToolConfig<
  BitbucketGetMergeTaskStatusParams,
  BitbucketToolResponse<BitbucketMergeTaskOutput>
> = {
  id: 'bitbucket_get_pull_request_merge_task_status',
  name: 'Bitbucket Get Merge Task Status',
  description: 'Poll the status of an asynchronous pull request merge task',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pullrequest'] },
  params: {
    ...BITBUCKET_PULL_REQUEST_PARAMS,
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Merge task ID returned by Bitbucket Merge Pull Request',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketPullRequestPath(params.workspaceSlug, params.repoSlug, params.prId)}/merge/task-status/${encodeBitbucketSegment(params.taskId, 'taskId')}`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => {
    const data = await bitbucketJson(response)
    if (data.type === 'error') {
      const error = record(data.error)
      const message = stringField(error?.message)?.trim()
      if (!message) throw new Error('Bitbucket returned a malformed merge task error')
      const detail = stringField(error?.detail)?.trim()
      throw new Error(detail && detail !== message ? `${message}: ${detail}` : message)
    }

    const taskStatus = data.task_status
    if (taskStatus !== 'PENDING' && taskStatus !== 'SUCCESS') {
      throw new Error('Bitbucket merge task status must be PENDING or SUCCESS')
    }

    const links = record(data.links)
    const self = record(links?.self)
    let mergeResult: BitbucketPullRequest | null = null
    if (taskStatus === 'SUCCESS') {
      const result = record(data.merge_result)
      if (!result) throw new Error('Bitbucket successful merge task omitted merge_result')
      mergeResult = normalizeBitbucketPullRequest(result)
    }

    return {
      success: true,
      output: {
        taskStatus,
        selfUrl: stringField(self?.href),
        mergeResult,
      },
    }
  },
  outputs: {
    taskStatus: { type: 'string', description: 'PENDING or SUCCESS' },
    selfUrl: { type: 'string', description: 'Merge task API URL', nullable: true },
    mergeResult: {
      type: 'object',
      description: 'Merged pull request when the task succeeds',
      nullable: true,
      properties: BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}

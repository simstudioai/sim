import {
  executeBitbucketGetFileOperation,
  executeBitbucketGetPipelineStepLogOperation,
  executeBitbucketGetPullRequestDiffOperation,
  executeBitbucketGetPullRequestDiffstatOperation,
} from '@/lib/internal/bitbucket/operations'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeBitbucketTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'bitbucket_get_file':
      return executeToolOperationImplementation(executeBitbucketGetFileOperation, request)
    case 'bitbucket_get_pipeline_step_log':
      return executeToolOperationImplementation(
        executeBitbucketGetPipelineStepLogOperation,
        request
      )
    case 'bitbucket_get_pull_request_diff':
      return executeToolOperationImplementation(
        executeBitbucketGetPullRequestDiffOperation,
        request
      )
    case 'bitbucket_get_pull_request_diffstat':
      return executeToolOperationImplementation(
        executeBitbucketGetPullRequestDiffstatOperation,
        request
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported bitbucket tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}

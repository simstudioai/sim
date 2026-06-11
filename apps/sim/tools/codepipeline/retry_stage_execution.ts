import type {
  CodePipelineRetryStageExecutionParams,
  CodePipelineRetryStageExecutionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const retryStageExecutionTool: ToolConfig<
  CodePipelineRetryStageExecutionParams,
  CodePipelineRetryStageExecutionResponse
> = {
  id: 'codepipeline_retry_stage_execution',
  name: 'CodePipeline Retry Stage Execution',
  description: 'Retry the failed actions (or all actions) of a failed CodePipeline stage',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    pipelineName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the pipeline',
    },
    stageName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the failed stage to retry',
    },
    pipelineExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the pipeline execution in the failed stage',
    },
    retryMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Scope of the retry: FAILED_ACTIONS or ALL_ACTIONS',
    },
  },

  request: {
    url: '/api/tools/codepipeline/retry-stage-execution',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      stageName: params.stageName,
      pipelineExecutionId: params.pipelineExecutionId,
      retryMode: params.retryMode,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to retry CodePipeline stage execution')
    }

    return {
      success: true,
      output: {
        pipelineExecutionId: data.output.pipelineExecutionId,
      },
    }
  },

  outputs: {
    pipelineExecutionId: {
      type: 'string',
      description: 'ID of the pipeline execution with the retried stage',
    },
  },
}

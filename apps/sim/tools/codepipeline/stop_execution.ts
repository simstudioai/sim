import type {
  CodePipelineStopExecutionParams,
  CodePipelineStopExecutionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const stopExecutionTool: ToolConfig<
  CodePipelineStopExecutionParams,
  CodePipelineStopExecutionResponse
> = {
  id: 'codepipeline_stop_execution',
  name: 'CodePipeline Stop Execution',
  description:
    'Stop a CodePipeline pipeline execution, either finishing in-progress actions or abandoning them',
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
    pipelineExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the pipeline execution to stop',
    },
    abandon: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Abandon in-progress actions instead of letting them finish (default false)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for stopping the execution (max 200 characters)',
    },
  },

  request: {
    url: '/api/tools/codepipeline/stop-execution',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      pipelineExecutionId: params.pipelineExecutionId,
      ...(params.abandon !== undefined && { abandon: params.abandon }),
      ...(params.reason && { reason: params.reason }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to stop CodePipeline pipeline execution')
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
      description: 'ID of the pipeline execution that was stopped',
    },
  },
}

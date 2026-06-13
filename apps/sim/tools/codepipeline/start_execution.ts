import type {
  CodePipelineStartExecutionParams,
  CodePipelineStartExecutionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const startExecutionTool: ToolConfig<
  CodePipelineStartExecutionParams,
  CodePipelineStartExecutionResponse
> = {
  id: 'codepipeline_start_execution',
  name: 'CodePipeline Start Execution',
  description: 'Start a CodePipeline pipeline execution, optionally overriding pipeline variables',
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
      description: 'Name of the pipeline to start',
    },
    clientRequestToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idempotency token to identify a unique execution request',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipeline variable overrides as an array of { name, value } objects',
    },
  },

  request: {
    url: '/api/tools/codepipeline/start-execution',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      ...(params.clientRequestToken && { clientRequestToken: params.clientRequestToken }),
      ...(params.variables && params.variables.length > 0 && { variables: params.variables }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start CodePipeline pipeline execution')
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
      description: 'ID of the pipeline execution that was started',
    },
  },
}

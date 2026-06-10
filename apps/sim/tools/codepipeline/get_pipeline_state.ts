import type {
  CodePipelineGetPipelineStateParams,
  CodePipelineGetPipelineStateResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const getPipelineStateTool: ToolConfig<
  CodePipelineGetPipelineStateParams,
  CodePipelineGetPipelineStateResponse
> = {
  id: 'codepipeline_get_pipeline_state',
  name: 'CodePipeline Get Pipeline State',
  description:
    'Get the current state of a CodePipeline pipeline, including stage and action status and pending approval tokens',
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
  },

  request: {
    url: '/api/tools/codepipeline/get-pipeline-state',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CodePipeline pipeline state')
    }

    return {
      success: true,
      output: {
        pipelineName: data.output.pipelineName,
        pipelineVersion: data.output.pipelineVersion,
        created: data.output.created,
        updated: data.output.updated,
        stageStates: data.output.stageStates,
      },
    }
  },

  outputs: {
    pipelineName: { type: 'string', description: 'Pipeline name' },
    pipelineVersion: { type: 'number', description: 'Pipeline version number', optional: true },
    created: {
      type: 'number',
      description: 'Epoch ms when the pipeline was created',
      optional: true,
    },
    updated: {
      type: 'number',
      description: 'Epoch ms when the pipeline was last updated',
      optional: true,
    },
    stageStates: {
      type: 'array',
      description: 'Per-stage state including latest execution status and action details',
      items: {
        type: 'object',
        properties: {
          stageName: { type: 'string', description: 'Stage name' },
          status: {
            type: 'string',
            description:
              'Latest stage execution status (InProgress, Succeeded, Failed, Stopped, Cancelled)',
          },
          pipelineExecutionId: {
            type: 'string',
            description: 'Pipeline execution ID currently in the stage',
          },
          inboundTransitionEnabled: {
            type: 'boolean',
            description: 'Whether the inbound transition into the stage is enabled',
          },
          actionStates: {
            type: 'array',
            description:
              'Per-action state with status, summary, error details, and approval token (for pending manual approvals)',
          },
        },
      },
    },
  },
}

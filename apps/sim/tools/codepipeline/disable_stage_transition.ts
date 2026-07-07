import type {
  CodePipelineDisableStageTransitionParams,
  CodePipelineDisableStageTransitionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const disableStageTransitionTool: ToolConfig<
  CodePipelineDisableStageTransitionParams,
  CodePipelineDisableStageTransitionResponse
> = {
  id: 'codepipeline_disable_stage_transition',
  name: 'CodePipeline Disable Stage Transition',
  description:
    'Prevent artifacts from transitioning into or out of a CodePipeline stage, freezing the pipeline at that point',
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
      description: 'Name of the stage to disable the transition for',
    },
    transitionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Inbound to block artifacts entering the stage, Outbound to block artifacts leaving it',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reason the transition is disabled, shown in the pipeline console (max 300 characters)',
    },
  },

  request: {
    url: '/api/tools/codepipeline/disable-stage-transition',
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
      transitionType: params.transitionType,
      reason: params.reason,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to disable CodePipeline stage transition')
    }

    return {
      success: true,
      output: {
        pipelineName: data.output.pipelineName,
        stageName: data.output.stageName,
        transitionType: data.output.transitionType,
      },
    }
  },

  outputs: {
    pipelineName: { type: 'string', description: 'Pipeline name' },
    stageName: { type: 'string', description: 'Stage whose transition was disabled' },
    transitionType: {
      type: 'string',
      description: 'Transition type that was disabled (Inbound or Outbound)',
    },
  },
}

import type {
  CodePipelineEnableStageTransitionParams,
  CodePipelineEnableStageTransitionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const enableStageTransitionTool: ToolConfig<
  CodePipelineEnableStageTransitionParams,
  CodePipelineEnableStageTransitionResponse
> = {
  id: 'codepipeline_enable_stage_transition',
  name: 'CodePipeline Enable Stage Transition',
  description:
    'Re-enable artifacts transitioning into or out of a CodePipeline stage after it was disabled',
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
      description: 'Name of the stage to enable the transition for',
    },
    transitionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Inbound to allow artifacts entering the stage, Outbound to allow artifacts leaving it',
    },
  },

  request: {
    url: '/api/tools/codepipeline/enable-stage-transition',
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
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to enable CodePipeline stage transition')
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
    stageName: { type: 'string', description: 'Stage whose transition was enabled' },
    transitionType: {
      type: 'string',
      description: 'Transition type that was enabled (Inbound or Outbound)',
    },
  },
}

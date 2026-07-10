import type {
  CodePipelineGetPipelineParams,
  CodePipelineGetPipelineResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const getPipelineTool: ToolConfig<
  CodePipelineGetPipelineParams,
  CodePipelineGetPipelineResponse
> = {
  id: 'codepipeline_get_pipeline',
  name: 'CodePipeline Get Pipeline',
  description:
    'Get the structure of a CodePipeline pipeline, including its stages, actions, and variables',
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
    version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipeline version to retrieve (defaults to the current version)',
    },
  },

  request: {
    url: '/api/tools/codepipeline/get-pipeline',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      ...(params.version !== undefined && { version: params.version }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CodePipeline pipeline')
    }

    return {
      success: true,
      output: {
        pipelineName: data.output.pipelineName,
        pipelineArn: data.output.pipelineArn,
        roleArn: data.output.roleArn,
        version: data.output.version,
        pipelineType: data.output.pipelineType,
        executionMode: data.output.executionMode,
        artifactStoreType: data.output.artifactStoreType,
        artifactStoreLocation: data.output.artifactStoreLocation,
        stages: data.output.stages,
        variables: data.output.variables,
        created: data.output.created,
        updated: data.output.updated,
      },
    }
  },

  outputs: {
    pipelineName: { type: 'string', description: 'Pipeline name' },
    pipelineArn: { type: 'string', description: 'Pipeline ARN', optional: true },
    roleArn: { type: 'string', description: 'IAM role ARN the pipeline assumes' },
    version: { type: 'number', description: 'Pipeline version number', optional: true },
    pipelineType: { type: 'string', description: 'Pipeline type (V1 or V2)', optional: true },
    executionMode: {
      type: 'string',
      description: 'Execution mode (QUEUED, SUPERSEDED, PARALLEL)',
      optional: true,
    },
    artifactStoreType: {
      type: 'string',
      description: 'Artifact store type (S3)',
      optional: true,
    },
    artifactStoreLocation: {
      type: 'string',
      description: 'Artifact store bucket location',
      optional: true,
    },
    stages: {
      type: 'array',
      description: 'Pipeline stages with their actions (name, category, provider, configuration)',
      items: {
        type: 'object',
        properties: {
          stageName: { type: 'string', description: 'Stage name' },
          actions: {
            type: 'array',
            description: 'Actions in the stage, in run order',
          },
        },
      },
    },
    variables: {
      type: 'array',
      description: 'Pipeline variable declarations with default values',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable name' },
          defaultValue: { type: 'string', description: 'Default value' },
          description: { type: 'string', description: 'Variable description' },
        },
      },
    },
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
  },
}

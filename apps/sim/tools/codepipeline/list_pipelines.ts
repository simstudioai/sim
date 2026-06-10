import type {
  CodePipelineListPipelinesParams,
  CodePipelineListPipelinesResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const listPipelinesTool: ToolConfig<
  CodePipelineListPipelinesParams,
  CodePipelineListPipelinesResponse
> = {
  id: 'codepipeline_list_pipelines',
  name: 'CodePipeline List Pipelines',
  description: 'List all CodePipeline pipelines in an AWS account and region',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pipelines to return (1-1000)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous call',
    },
  },

  request: {
    url: '/api/tools/codepipeline/list-pipelines',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CodePipeline pipelines')
    }

    return {
      success: true,
      output: {
        pipelines: data.output.pipelines,
        nextToken: data.output.nextToken,
      },
    }
  },

  outputs: {
    pipelines: {
      type: 'array',
      description: 'List of pipelines with name, version, type, and timestamps',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Pipeline name' },
          version: { type: 'number', description: 'Pipeline version number' },
          pipelineType: { type: 'string', description: 'Pipeline type (V1 or V2)' },
          executionMode: {
            type: 'string',
            description: 'Execution mode (QUEUED, SUPERSEDED, PARALLEL)',
          },
          created: { type: 'number', description: 'Epoch ms when the pipeline was created' },
          updated: { type: 'number', description: 'Epoch ms when the pipeline was last updated' },
        },
      },
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
  },
}

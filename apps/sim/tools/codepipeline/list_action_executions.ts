import type {
  CodePipelineListActionExecutionsParams,
  CodePipelineListActionExecutionsResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const listActionExecutionsTool: ToolConfig<
  CodePipelineListActionExecutionsParams,
  CodePipelineListActionExecutionsResponse
> = {
  id: 'codepipeline_list_action_executions',
  name: 'CodePipeline List Action Executions',
  description:
    'List action-level execution history for a CodePipeline pipeline, including per-action status, timing, and error details',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return action executions for this pipeline execution',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of action executions to return (1-100, default 100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous call',
    },
  },

  request: {
    url: '/api/tools/codepipeline/list-action-executions',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      ...(params.pipelineExecutionId && { pipelineExecutionId: params.pipelineExecutionId }),
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CodePipeline action executions')
    }

    return {
      success: true,
      output: {
        actionExecutionDetails: data.output.actionExecutionDetails,
        nextToken: data.output.nextToken,
      },
    }
  },

  outputs: {
    actionExecutionDetails: {
      type: 'array',
      description: 'Action execution history, most recent first',
      items: {
        type: 'object',
        properties: {
          pipelineExecutionId: { type: 'string', description: 'Pipeline execution ID' },
          actionExecutionId: {
            type: 'string',
            description:
              'Action execution ID (use as the approval token for PARALLEL execution-mode pipelines)',
          },
          pipelineVersion: { type: 'number', description: 'Pipeline version number' },
          stageName: { type: 'string', description: 'Stage the action belongs to' },
          actionName: { type: 'string', description: 'Action name' },
          startTime: { type: 'number', description: 'Epoch ms when the action started' },
          lastUpdateTime: {
            type: 'number',
            description: 'Epoch ms when the action was last updated',
          },
          updatedBy: { type: 'string', description: 'Who or what last updated the action' },
          status: {
            type: 'string',
            description: 'Action execution status (InProgress, Abandoned, Succeeded, Failed)',
          },
          externalExecutionId: {
            type: 'string',
            description: 'ID of the external system execution (e.g., CodeBuild build ID)',
          },
          externalExecutionSummary: {
            type: 'string',
            description: 'Summary from the external system execution',
          },
          externalExecutionUrl: {
            type: 'string',
            description: 'URL of the external system execution',
          },
          errorCode: { type: 'string', description: 'Error code if the action failed' },
          errorMessage: { type: 'string', description: 'Error message if the action failed' },
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

import type {
  CodePipelineListPipelineExecutionsParams,
  CodePipelineListPipelineExecutionsResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const listPipelineExecutionsTool: ToolConfig<
  CodePipelineListPipelineExecutionsParams,
  CodePipelineListPipelineExecutionsResponse
> = {
  id: 'codepipeline_list_pipeline_executions',
  name: 'CodePipeline List Pipeline Executions',
  description: 'List recent executions of a CodePipeline pipeline with status and source revisions',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of executions to return (1-100, default 100)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous call',
    },
    succeededInStage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return executions that succeeded in this stage',
    },
  },

  request: {
    url: '/api/tools/codepipeline/list-pipeline-executions',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      ...(params.maxResults !== undefined && { maxResults: params.maxResults }),
      ...(params.nextToken && { nextToken: params.nextToken }),
      ...(params.succeededInStage && { succeededInStage: params.succeededInStage }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list CodePipeline pipeline executions')
    }

    return {
      success: true,
      output: {
        executions: data.output.executions,
        nextToken: data.output.nextToken,
      },
    }
  },

  outputs: {
    executions: {
      type: 'array',
      description: 'Pipeline execution summaries, most recent first',
      items: {
        type: 'object',
        properties: {
          pipelineExecutionId: { type: 'string', description: 'Pipeline execution ID' },
          status: {
            type: 'string',
            description:
              'Execution status (Cancelled, InProgress, Stopped, Stopping, Succeeded, Superseded, Failed)',
          },
          statusSummary: { type: 'string', description: 'Status summary for the execution' },
          startTime: { type: 'number', description: 'Epoch ms when the execution started' },
          lastUpdateTime: {
            type: 'number',
            description: 'Epoch ms when the execution was last updated',
          },
          executionMode: {
            type: 'string',
            description: 'Execution mode (QUEUED, SUPERSEDED, PARALLEL)',
          },
          executionType: {
            type: 'string',
            description: 'Execution type (STANDARD or ROLLBACK)',
          },
          stopTriggerReason: {
            type: 'string',
            description: 'Reason the execution was stopped, if applicable',
          },
          triggerType: { type: 'string', description: 'What triggered the execution' },
          triggerDetail: { type: 'string', description: 'Detail about the trigger' },
          rollbackTargetPipelineExecutionId: {
            type: 'string',
            description: 'Execution ID this run rolled back to, if it was a rollback',
          },
          sourceRevisions: {
            type: 'array',
            description: 'Source revisions (commit IDs, summaries, URLs) for the execution',
          },
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
